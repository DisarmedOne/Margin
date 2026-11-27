using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace MarginSetup
{
    // Layout of a built installer: [this exe][app zip][manifest json][zip length:8][json length:8]["MARGINPK":8]
    // The uninstaller is the same exe without anything appended.
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var self = Process.GetCurrentProcess().MainModule.FileName;
            // The app's updater can start us inside the install folder, which would lock it.
            Environment.CurrentDirectory = Path.GetTempPath();
            // The app's updater passes --updated, plus /S when it installs as Margin closes.
            bool updated = args.Contains("--updated"), silent = args.Contains("/S");
            var payload = Payload.Read(self);
            bool uninstall = args.Contains("--uninstall") || payload == null;

            if (uninstall)
            {
                string dir = ArgValue(args, "--dir") ?? Path.GetDirectoryName(self);
                // Windows can't delete a running exe, so the uninstaller runs from a temp copy.
                if (!args.Contains("--relaunched"))
                {
                    var tmp = Path.Combine(Path.GetTempPath(), $"margin-uninstall-{Guid.NewGuid():N}.exe");
                    File.Copy(self, tmp);
                    Process.Start(new ProcessStartInfo(tmp, $"--uninstall --relaunched --dir \"{dir}\"{(silent ? " /S" : "")}") { UseShellExecute = false });
                    return;
                }
                var ops = new Ops(dir, null, self);
                if (silent) RunSilently(() => { ops.CloseAfterWait(); ops.Uninstall(false, (p, s) => { }); ops.ScheduleSelfDelete(); });
                else Application.Run(new SetupForm(ops, uninstall: true));
            }
            else
            {
                var ops = new Ops(Ops.InstalledDir(), payload, self);
                if (silent)
                    RunSilently(() =>
                    {
                        ops.CloseAfterWait();
                        ops.Install(!updated || ops.HasDesktopShortcut, (p, s) => { });
                        if (args.Contains("--force-run")) ops.Launch();
                    });
                else Application.Run(new SetupForm(ops, uninstall: false, update: updated));
            }
        }

        static void RunSilently(Action work)
        {
            try { work(); }
            catch (Exception e)
            {
                Console.Error.WriteLine(e.Message);
                Environment.ExitCode = 1;
            }
        }

        static string ArgValue(string[] args, string name)
        {
            int i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }
    }

    class Payload
    {
        public long ZipOffset, ZipLength, StubLength;
        public string Version = "";
        static readonly byte[] Magic = Encoding.ASCII.GetBytes("MARGINPK");

        public static Payload Read(string exe)
        {
            using var fs = File.OpenRead(exe);
            if (fs.Length < 24) return null;
            var tail = new byte[24];
            fs.Seek(-24, SeekOrigin.End);
            fs.Read(tail, 0, 24);
            if (!tail.Skip(16).SequenceEqual(Magic)) return null;
            long zipLen = BitConverter.ToInt64(tail, 0), jsonLen = BitConverter.ToInt64(tail, 8);
            var p = new Payload { ZipLength = zipLen, ZipOffset = fs.Length - 24 - jsonLen - zipLen };
            p.StubLength = p.ZipOffset;
            var json = new byte[jsonLen];
            fs.Seek(-24 - jsonLen, SeekOrigin.End);
            fs.Read(json, 0, (int)jsonLen);
            var m = System.Text.RegularExpressions.Regex.Match(Encoding.UTF8.GetString(json), "\"version\"\\s*:\\s*\"([^\"]+)\"");
            if (m.Success) p.Version = m.Groups[1].Value;
            return p;
        }
    }

    // Read-only window onto part of a file, so ZipArchive can read the zip embedded in this exe.
    class SubStream : Stream
    {
        readonly Stream inner; readonly long start, length; long pos;
        public SubStream(Stream inner, long start, long length) { this.inner = inner; this.start = start; this.length = length; }
        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => length;
        public override long Position { get => pos; set => pos = value; }
        public override int Read(byte[] buffer, int offset, int count)
        {
            count = (int)Math.Min(count, length - pos);
            if (count <= 0) return 0;
            inner.Seek(start + pos, SeekOrigin.Begin);
            int n = inner.Read(buffer, offset, count);
            pos += n;
            return n;
        }
        public override long Seek(long offset, SeekOrigin origin)
        {
            pos = origin == SeekOrigin.Begin ? offset : origin == SeekOrigin.Current ? pos + offset : length + offset;
            return pos;
        }
        public override void Flush() { }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { if (disposing) inner.Dispose(); base.Dispose(disposing); }
    }

    class Ops
    {
        public static readonly string DefaultDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Margin");
        const string UninstallRoot = @"Software\Microsoft\Windows\CurrentVersion\Uninstall";
        const string UninstallKey = UninstallRoot + @"\Margin";
        public static readonly string DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Margin");
        static readonly string StartMenuLink = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Margin.lnk");
        static readonly string DesktopLink = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Margin.lnk");

        public string Dir;
        public readonly Payload Payload;
        readonly string self;
        public Ops(string dir, Payload payload, string self) { Dir = dir; Payload = payload; this.self = self; }

        public string AppExe => Path.Combine(Dir, "Margin.exe");
        public bool HasDesktopShortcut => File.Exists(DesktopLink);
        public void Launch() => Process.Start(new ProcessStartInfo(AppExe) { WorkingDirectory = Dir });

        // Where Margin already lives: our own entry, then one left by the plain installer used for 1.5.1 and 1.5.2.
        public static string InstalledDir()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(UninstallKey))
                if (k?.GetValue("InstallLocation") is string own && own.Length > 0) return own;
            using var root = Registry.CurrentUser.OpenSubKey(UninstallRoot);
            foreach (var name in root?.GetSubKeyNames() ?? new string[0])
            {
                using var k = root.OpenSubKey(name);
                if (!IsPlainInstallerEntry(k)) continue;
                var command = (string)k.GetValue("UninstallString");
                var folder = command.Substring(0, command.IndexOf("Uninstall Margin.exe", StringComparison.OrdinalIgnoreCase)).Trim('"').TrimEnd('\\');
                if (File.Exists(Path.Combine(folder, "Margin.exe"))) return folder;
            }
            return DefaultDir;
        }

        static bool IsPlainInstallerEntry(RegistryKey k) =>
            (k?.GetValue("DisplayName") as string)?.StartsWith("Margin") == true &&
            (k.GetValue("UninstallString") as string ?? "").IndexOf("Uninstall Margin.exe", StringComparison.OrdinalIgnoreCase) >= 0;

        // The updater starts us while Margin is still shutting down, so give it a moment before forcing it.
        public void CloseAfterWait()
        {
            for (int i = 0; i < 40 && RunningApps().Count > 0; i++) Thread.Sleep(250);
            CloseRunning();
        }

        // Only ever delete a folder that is empty or clearly holds a Margin install.
        public bool LooksLikeMarginInstall => File.Exists(AppExe) && File.Exists(Path.Combine(Dir, "resources", "app.asar"));
        public bool SafeToInstallInto => !Directory.Exists(Dir) || !Directory.EnumerateFileSystemEntries(Dir).Any() || LooksLikeMarginInstall;

        public List<Process> RunningApps()
        {
            var list = new List<Process>();
            foreach (var p in Process.GetProcessesByName("Margin"))
            {
                try { if (p.MainModule.FileName.StartsWith(Dir, StringComparison.OrdinalIgnoreCase)) list.Add(p); }
                catch { /* process from another user or already gone */ }
            }
            return list;
        }

        public void CloseRunning()
        {
            foreach (var p in RunningApps())
            {
                try { p.Kill(); p.WaitForExit(5000); } catch { }
            }
        }

        public void Install(bool desktopShortcut, Action<double, string> progress)
        {
            progress(0, "Preparing");
            if (!SafeToInstallInto) throw new IOException($"{Dir} already has other files in it. Choose an empty folder.");
            var staging = Dir.TrimEnd('\\') + ".new";
            var previous = Dir.TrimEnd('\\') + ".old";
            // Leftovers of an interrupted run; only this method creates these two folders.
            DeleteDir(staging);
            DeleteDir(previous);
            Directory.CreateDirectory(staging);

            long total = 0, done = 0;
            using (var zip = new ZipArchive(new SubStream(File.OpenRead(self), Payload.ZipOffset, Payload.ZipLength), ZipArchiveMode.Read))
            {
                total = zip.Entries.Sum(e => e.Length);
                var root = Path.GetFullPath(staging) + Path.DirectorySeparatorChar;
                foreach (var e in zip.Entries)
                {
                    var target = Path.GetFullPath(Path.Combine(staging, e.FullName));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue; // never write outside the install folder
                    if (e.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    e.ExtractToFile(target, true);
                    done += e.Length;
                    progress(0.92 * done / Math.Max(1, total), e.Name);
                }
            }

            progress(0.94, "Writing the uninstaller");
            using (var src = File.OpenRead(self))
            using (var dst = File.Create(Path.Combine(staging, "Uninstall Margin.exe")))
            {
                var buf = new byte[81920];
                long left = Payload.StubLength;
                while (left > 0)
                {
                    int n = src.Read(buf, 0, (int)Math.Min(buf.Length, left));
                    if (n <= 0) break;
                    dst.Write(buf, 0, n);
                    left -= n;
                }
            }

            if (Directory.Exists(Dir)) Directory.Move(Dir, previous); // throws, changing nothing, if a file is in use
            try { Directory.Move(staging, Dir); }
            catch
            {
                if (Directory.Exists(previous)) Directory.Move(previous, Dir);
                throw;
            }
            try { DeleteDir(previous); } catch { /* removed on the next install */ }
            RemoveOlderEntries();

            progress(0.97, "Adding shortcuts");
            CreateShortcut(StartMenuLink);
            if (desktopShortcut) CreateShortcut(DesktopLink);

            using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", "Margin");
                k.SetValue("DisplayVersion", Payload.Version);
                k.SetValue("Publisher", "Margin");
                k.SetValue("DisplayIcon", AppExe + ",0");
                k.SetValue("InstallLocation", Dir);
                k.SetValue("UninstallString", $"\"{Path.Combine(Dir, "Uninstall Margin.exe")}\" --uninstall");
                k.SetValue("QuietUninstallString", $"\"{Path.Combine(Dir, "Uninstall Margin.exe")}\" --uninstall /S");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", (int)(total / 1024), RegistryValueKind.DWord);
            }
            progress(1, "Done");
        }

        public void Uninstall(bool deleteData, Action<double, string> progress)
        {
            if (!LooksLikeMarginInstall) throw new IOException($"Margin is not installed in {Dir}.");
            progress(0.1, "Removing shortcuts");
            foreach (var link in new[] { StartMenuLink, DesktopLink })
                if (File.Exists(link)) File.Delete(link);

            progress(0.3, "Removing Margin");
            DeleteDir(Dir);

            progress(0.8, "Cleaning up");
            Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
            RemoveOlderEntries();
            if (deleteData) DeleteDir(DataDir);
            progress(1, "Done");
        }

        // Earlier builds used an NSIS installer with its own Apps & Features entry; replace it.
        static void RemoveOlderEntries()
        {
            using var root = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall", true);
            if (root == null) return;
            foreach (var name in root.GetSubKeyNames())
            {
                if (name == "Margin") continue;
                using var k = root.OpenSubKey(name);
                if ((k?.GetValue("DisplayName") as string)?.StartsWith("Margin") == true && (k.GetValue("UninstallString") as string ?? "").Contains("Uninstall Margin.exe"))
                    root.DeleteSubKeyTree(name, false);
            }
        }

        static void DeleteDir(string dir)
        {
            for (int attempt = 0; Directory.Exists(dir); attempt++)
            {
                try { Directory.Delete(dir, true); }
                catch when (attempt < 10) { Thread.Sleep(300); }
            }
        }

        void CreateShortcut(string path)
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(shellType);
            dynamic link = shell.CreateShortcut(path);
            link.TargetPath = AppExe;
            link.WorkingDirectory = Dir;
            link.IconLocation = AppExe + ",0";
            link.Description = "Study papers by playing them.";
            link.Save();
        }

        // Deletes the temp copy of the uninstaller after it exits.
        public void ScheduleSelfDelete()
        {
            Process.Start(new ProcessStartInfo("cmd.exe", $"/c ping 127.0.0.1 -n 3 > nul & del \"{self}\"")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden,
            });
        }
    }
}
