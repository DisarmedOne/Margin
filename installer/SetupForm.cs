using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace MarginSetup
{
    // One borderless window, painted by hand in Margin's paper-and-ink style. All layout is in
    // 96-dpi design units and scaled at paint time.
    class SetupForm : Form
    {
        enum Screen { Welcome, AppRunning, Busy, Done, Error, ConfirmUninstall, NotInstalled }

        const int W = 760, H = 480, Side = 244, X0 = 292, ContentW = 420;
        static readonly Color Bg = Hex("F2EFE7"), Surface = Hex("FAF8F3"), Sunken = Hex("E9E5DA"), Ink = Hex("1A1917"), Ink2 = Hex("45423C"),
            Ink3 = Hex("7D786E"), Rule = Hex("D9D3C5"), RuleStrong = Hex("BDB5A4"), Accent = Hex("B5462B"), MarginRule = Hex("E7C3B7"), Bad = Hex("A8362A");

        readonly Ops ops;
        readonly bool uninstall, update;
        Screen screen;
        float scale = 1;
        bool desktopShortcut = true, deleteData;
        string error = "", status = "";
        double target, shown;
        readonly Timer timer = new Timer { Interval = 15 };

        class Hot { public RectangleF R; public Action Click; public string Id; }
        readonly List<Hot> hots = new List<Hot>();
        string hover;
        Action primary, secondary;

        readonly Font fDisplay = new Font("Georgia", 27, FontStyle.Bold, GraphicsUnit.Pixel);
        readonly Font fWord = new Font("Georgia", 22, FontStyle.Bold, GraphicsUnit.Pixel);
        readonly Font fBig = new Font("Georgia", 118, FontStyle.Bold, GraphicsUnit.Pixel);
        readonly Font fSideLine = new Font("Georgia", 15, FontStyle.Regular, GraphicsUnit.Pixel);
        readonly Font fBody = new Font("Segoe UI", 14, FontStyle.Regular, GraphicsUnit.Pixel);
        readonly Font fSmall = new Font("Segoe UI", 12.5f, FontStyle.Regular, GraphicsUnit.Pixel);
        readonly Font fButton = new Font("Segoe UI Semibold", 13.5f, FontStyle.Regular, GraphicsUnit.Pixel);
        readonly Font fLabel = new Font("Consolas", 10.5f, FontStyle.Regular, GraphicsUnit.Pixel);
        readonly Font fMono = new Font("Consolas", 12, FontStyle.Regular, GraphicsUnit.Pixel);

        public SetupForm(Ops ops, bool uninstall, bool update = false)
        {
            this.ops = ops;
            this.uninstall = uninstall;
            this.update = update;
            if (update) { desktopShortcut = ops.HasDesktopShortcut; status = "Preparing"; }
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.None;
            DoubleBuffered = true;
            BackColor = Bg;
            Text = uninstall ? "Uninstall Margin" : update ? "Updating Margin" : "Margin Setup";
            try { Icon = Icon.ExtractAssociatedIcon(Process.GetCurrentProcess().MainModule.FileName); } catch { }
            screen = uninstall ? (ops.LooksLikeMarginInstall ? Screen.ConfirmUninstall : Screen.NotInstalled) : update ? Screen.Busy : Screen.Welcome;
            timer.Tick += (s, e) =>
            {
                shown += (target - shown) * 0.12;
                if (Math.Abs(target - shown) < 0.001) shown = target;
                Invalidate();
            };
        }

        // ---------- window chrome ----------
        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ClassStyle |= 0x20000; /* CS_DROPSHADOW */ return cp; }
        }

        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int round = 2; // DWMWCP_ROUND, Windows 11 rounded corners
            try { DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int)); } catch { }
            ApplyScale(DeviceDpi);
            CenterToScreen();
        }

        protected override void OnDpiChanged(DpiChangedEventArgs e)
        {
            base.OnDpiChanged(e);
            ApplyScale(e.DeviceDpiNew);
        }

        void ApplyScale(int dpi)
        {
            scale = dpi / 96f;
            ClientSize = new Size((int)(W * scale), (int)(H * scale));
            Invalidate();
        }

        // ---------- input ----------
        PointF Design(Point p) => new PointF(p.X / scale, p.Y / scale);
        Hot HotAt(Point p) { var d = Design(p); return hots.FindLast(h => h.R.Contains(d)); }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            var h = HotAt(e.Location);
            Cursor = h != null ? Cursors.Hand : Cursors.Default;
            if (h?.Id != hover) { hover = h?.Id; Invalidate(); }
        }

        protected override void OnMouseLeave(EventArgs e) { hover = null; Invalidate(); }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            var h = HotAt(e.Location);
            if (h != null) { h.Click(); return; }
            ReleaseCapture(); // drag the window from anywhere else
            SendMessage(Handle, 0xA1, (IntPtr)2, IntPtr.Zero);
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.Enter || keyData == Keys.Escape)
            {
                var act = keyData == Keys.Enter ? primary : secondary;
                if (act != null) act();
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (screen == Screen.Busy) e.Cancel = true; // never leave a half-written install
            base.OnFormClosing(e);
        }

        // Actions are rebuilt on the next paint; clearing them here stops a queued key from firing a stale one.
        void Go(Screen s) { screen = s; hover = null; primary = secondary = null; hots.Clear(); Invalidate(); }

        // ---------- actions ----------
        // An update needs no questions: it starts as soon as the window appears.
        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (update) { screen = Screen.Welcome; StartWork(); }
        }

        void StartWork()
        {
            if (screen == Screen.Busy) return;
            if (!update && ops.RunningApps().Count > 0) { Go(Screen.AppRunning); return; }
            target = shown = 0;
            status = "Preparing";
            Go(Screen.Busy);
            timer.Start();
            Task.Run(() =>
            {
                Action<double, string> report = (p, s) => { target = p; status = s; };
                if (update) ops.CloseAfterWait();
                if (uninstall) ops.Uninstall(deleteData, report);
                else ops.Install(desktopShortcut, report);
            }).ContinueWith(t => BeginInvoke(new Action(() =>
            {
                if (t.Exception != null)
                {
                    timer.Stop();
                    error = t.Exception.GetBaseException().Message;
                    Go(Screen.Error);
                    return;
                }
                target = shown = 1;
                timer.Stop();
                Go(Screen.Done);
                if (update) ReopenSoon();
            })));
        }

        // Holds the finished screen for a moment, then brings the new version up.
        async void ReopenSoon()
        {
            await Task.Delay(1400);
            if (IsDisposed) return;
            ops.Launch();
            Close();
        }

        void PickFolder()
        {
            using var d = new FolderBrowserDialog { Description = "Choose where to install Margin", SelectedPath = Path.GetDirectoryName(ops.Dir) };
            if (d.ShowDialog(this) != DialogResult.OK) return;
            var dir = d.SelectedPath;
            if (!string.Equals(Path.GetFileName(dir), "Margin", StringComparison.OrdinalIgnoreCase)) dir = Path.Combine(dir, "Margin");
            ops.Dir = dir;
            Invalidate();
        }

        void Finish()
        {
            if (uninstall) ops.ScheduleSelfDelete();
            Close();
        }

        // ---------- painting ----------
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.ScaleTransform(scale, scale);
            hots.Clear();
            primary = secondary = null;

            DrawSide(g);
            CloseButton(g);

            float y = 70;
            switch (screen)
            {
                case Screen.Welcome:
                    y = Label(g, $"Setup{(ops.Payload.Version != "" ? " · version " + ops.Payload.Version : "")}", y);
                    y = Heading(g, "Install Margin.", y);
                    y = Body(g, "Margin turns any paper into a short route of ten-minute levels. Setup takes under a minute and needs no administrator rights.", y);
                    y += 22;
                    y = Label(g, "Install location", y);
                    y = PathBox(g, ops.Dir, y);
                    y += 16;
                    Checkbox(g, "desk", "Add a shortcut to the desktop", desktopShortcut, () => { desktopShortcut = !desktopShortcut; Invalidate(); }, y);
                    Buttons(g, ("install", "Install", (Action)StartWork), ("cancel", "Cancel", (Action)Close));
                    break;

                case Screen.ConfirmUninstall:
                    y = Label(g, "Uninstall", y);
                    y = Heading(g, "Uninstall Margin?", y);
                    y = Body(g, "This removes the app from this computer. Your papers and progress are kept unless you tick the box below, so they will be there if you come back.", y);
                    y += 26;
                    Checkbox(g, "data", "Also delete my papers, levels and progress", deleteData, () => { deleteData = !deleteData; Invalidate(); }, y);
                    Buttons(g, ("go", "Uninstall", (Action)StartWork), ("keep", "Keep Margin", (Action)Close));
                    break;

                case Screen.NotInstalled:
                    y = Label(g, "Uninstall", y);
                    y = Heading(g, "Nothing to remove.", y);
                    Body(g, $"Margin is not installed in {ops.Dir}. If you moved it, uninstall it from Settings > Apps instead.", y);
                    Buttons(g, ("close", "Close", (Action)Close));
                    break;

                case Screen.AppRunning:
                    y = Label(g, "Before we start", y);
                    y = Heading(g, "Margin is open.", y);
                    Body(g, "Setup needs to close it first. Your papers and progress are saved as you go, so nothing is lost.", y);
                    Buttons(g, ("closeapp", "Close Margin and continue", (Action)(() => { ops.CloseRunning(); StartWork(); })), ("cancel", "Cancel", (Action)Close));
                    break;

                case Screen.Busy:
                    y = Label(g, uninstall ? "Uninstalling" : update ? "Updating to version " + ops.Payload.Version : "Installing", y);
                    y = Heading(g, uninstall ? "Removing Margin." : update ? "Turning the page." : "Setting up your desk.", y);
                    y = Body(g, uninstall ? "This takes a few seconds." : update ? "Your papers and progress stay as they are. Margin reopens by itself." : "Unpacking Margin. This takes under a minute.", y);
                    Progress(g, y + 40);
                    break;

                case Screen.Done:
                    y = Label(g, "Done", y);
                    if (uninstall)
                    {
                        y = Heading(g, "Margin has been removed.", y);
                        Body(g, deleteData ? "Your papers and progress were deleted too." : "Your papers and progress are still in AppData\\Roaming\\Margin, in case you come back.", y);
                        Buttons(g, ("close", "Close", (Action)Finish));
                    }
                    else if (update)
                    {
                        y = Heading(g, "Margin is up to date.", y);
                        Body(g, "Opening version " + ops.Payload.Version + ".", y);
                    }
                    else
                    {
                        y = Heading(g, "Margin is ready.", y);
                        Body(g, desktopShortcut ? "You will find it in the Start menu and on your desktop. Your first paper is one drag and drop away." : "You will find it in the Start menu. Your first paper is one drag and drop away.", y);
                        Buttons(g, ("open", "Open Margin", (Action)(() => { Process.Start(new ProcessStartInfo(ops.AppExe) { WorkingDirectory = ops.Dir }); Close(); })), ("close", "Close", (Action)Close));
                    }
                    break;

                case Screen.Error:
                    y = Label(g, "Something went wrong", y, Bad);
                    y = Heading(g, uninstall ? "Uninstall could not finish." : "Setup could not finish.", y);
                    y = Body(g, error, y);
                    Body(g, "Nothing outside the install folder was changed.", y + 6, Ink3);
                    Buttons(g, ("retry", "Try again", (Action)StartWork), ("close", "Close", (Action)Close));
                    break;
            }

            using var border = new Pen(RuleStrong, 1 / scale);
            g.DrawRectangle(border, 0, 0, W - 1 / scale, H - 1 / scale);
        }

        void DrawSide(Graphics g)
        {
            using (var b = new SolidBrush(Sunken)) g.FillRectangle(b, 0, 0, Side, H);
            using (var p = new Pen(Rule, 1)) g.DrawLine(p, Side, 0, Side, H);
            using (var p = new Pen(MarginRule, 1)) g.DrawLine(p, 18, 0, 18, H);

            g.DrawString("Margin", fWord, Brush(Ink), 34, 34);
            var ww = g.MeasureString("Margin", fWord, PointF.Empty, StringFormat.GenericTypographic).Width;
            g.FillRectangle(Brush(Accent), 34 + ww + 8, 51, 6, 6);
            g.FillRectangle(Brush(Ink), 36, 78, Side - 68, 2);

            g.DrawString("M", fBig, Brush(Ink), 26, 98);
            var mw = g.MeasureString("M", fBig, PointF.Empty, StringFormat.GenericTypographic).Width;
            g.FillRectangle(Brush(Accent), 26 + mw + 10, 196, 14, 14);

            Tracked(g, uninstall ? "UNINSTALL" : update ? "UPDATE" : "SETUP", fLabel, Ink3, 36, 392);
            g.DrawString(uninstall ? "Thanks for\nreading with us." : update ? "A fresh edition\nis on its way." : "Study papers\nby playing them.", fSideLine, Brush(Ink), 34, 410);
        }

        void CloseButton(Graphics g)
        {
            if (screen == Screen.Busy) return;
            var r = new RectangleF(W - 46, 12, 32, 32);
            hots.Add(new Hot { R = r, Click = screen == Screen.Done && uninstall ? Finish : (Action)Close, Id = "x" });
            if (hover == "x") g.FillRectangle(Brush(Sunken), r);
            using var p = new Pen(Ink2, 1.4f);
            g.DrawLine(p, r.X + 11, r.Y + 11, r.Right - 11, r.Bottom - 11);
            g.DrawLine(p, r.Right - 11, r.Y + 11, r.X + 11, r.Bottom - 11);
        }

        float Label(Graphics g, string text, float y, Color? color = null)
        {
            Tracked(g, text.ToUpperInvariant(), fLabel, color ?? Ink3, X0, y);
            return y + 26;
        }

        float Heading(Graphics g, string text, float y)
        {
            // Typographic format drops GDI+'s side padding so the headline lines up with the label.
            var fmt = StringFormat.GenericTypographic;
            var size = g.MeasureString(text, fDisplay, (int)ContentW, fmt);
            g.DrawString(text, fDisplay, Brush(Ink), new RectangleF(X0, y + 2, ContentW, size.Height + 4), fmt);
            return y + size.Height + 18;
        }

        float Body(Graphics g, string text, float y, Color? color = null)
        {
            var size = g.MeasureString(text, fBody, (int)(ContentW - 20));
            g.DrawString(text, fBody, Brush(color ?? Ink2), new RectangleF(X0, y, ContentW - 20, size.Height + 4));
            return y + size.Height;
        }

        float PathBox(Graphics g, string path, float y)
        {
            var r = new RectangleF(X0, y, ContentW, 40);
            g.FillRectangle(Brush(Surface), r);
            using (var p = new Pen(RuleStrong, 1)) g.DrawRectangle(p, r.X, r.Y, r.Width, r.Height);
            var fmt = new StringFormat { Trimming = StringTrimming.EllipsisPath, FormatFlags = StringFormatFlags.NoWrap, LineAlignment = StringAlignment.Center };
            g.DrawString(path, fMono, Brush(Ink), new RectangleF(r.X + 12, r.Y, r.Width - 96, r.Height), fmt);

            var lr = new RectangleF(r.Right - 76, r.Y + 6, 68, 28);
            hots.Add(new Hot { R = lr, Click = PickFolder, Id = "change" });
            var lf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            g.DrawString("Change", fSmall, Brush(Ink), lr, lf);
            var tw = g.MeasureString("Change", fSmall).Width;
            using (var p = new Pen(hover == "change" ? Accent : RuleStrong, 1))
                g.DrawLine(p, lr.X + (lr.Width - tw) / 2 + 3, lr.Bottom - 5, lr.X + (lr.Width + tw) / 2 - 3, lr.Bottom - 5);
            return y + 40;
        }

        void Checkbox(Graphics g, string id, string text, bool on, Action toggle, float y)
        {
            var box = new RectangleF(X0, y + 2, 18, 18);
            var tw = g.MeasureString(text, fBody).Width;
            hots.Add(new Hot { R = new RectangleF(X0, y - 2, 26 + tw, 26), Click = toggle, Id = id });
            g.FillRectangle(Brush(on ? Ink : Surface), box);
            using (var p = new Pen(hover == id || on ? Ink : RuleStrong, 1.2f)) g.DrawRectangle(p, box.X, box.Y, box.Width, box.Height);
            if (on)
            {
                using var p = new Pen(Bg, 2f);
                g.DrawLines(p, new[] { new PointF(box.X + 4, box.Y + 9.5f), new PointF(box.X + 7.5f, box.Y + 13), new PointF(box.X + 14, box.Y + 5.5f) });
            }
            g.DrawString(text, fBody, Brush(Ink), X0 + 28, y);
        }

        void Buttons(Graphics g, params (string id, string text, Action click)[] buttons)
        {
            float x = X0, y = H - 40 - 44;
            for (int i = 0; i < buttons.Length; i++)
            {
                var (id, text, click) = buttons[i];
                bool main = i == 0;
                float w = Math.Max(main ? 132 : 96, g.MeasureString(text, fButton).Width + 40);
                var r = new RectangleF(x, y, w, 44);
                hots.Add(new Hot { R = r, Click = click, Id = id });
                bool hot = hover == id;
                if (main)
                {
                    g.FillRectangle(Brush(hot ? Ink2 : Ink), r);
                }
                else
                {
                    if (hot) g.FillRectangle(Brush(Sunken), r);
                }
                var f = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
                g.DrawString(text, fButton, Brush(main ? Bg : Ink), r, f);
                x += w + 10;
            }
            primary = buttons[0].click;
            secondary = buttons.Length > 1 ? buttons[buttons.Length - 1].click : buttons[0].click;
        }

        void Progress(Graphics g, float y)
        {
            g.FillRectangle(Brush(Rule), X0, y, ContentW, 6);
            g.FillRectangle(Brush(Ink), X0, y, (float)(ContentW * shown), 6);
            var pct = $"{(int)Math.Round(shown * 100)}%";
            var pw = g.MeasureString(pct, fMono).Width;
            g.DrawString(pct, fMono, Brush(Ink), X0 + ContentW - pw + 4, y + 16);
            var fmt = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap };
            g.DrawString(status, fMono, Brush(Ink3), new RectangleF(X0 - 2, y + 16, ContentW - pw - 16, 20), fmt);
        }

        // GDI+ has no letter-spacing, so labels are drawn a character at a time.
        static void Tracked(Graphics g, string text, Font f, Color c, float x, float y)
        {
            using var b = new SolidBrush(c);
            foreach (var ch in text)
            {
                var s = ch.ToString();
                g.DrawString(s, f, b, x, y, StringFormat.GenericTypographic);
                x += (ch == ' ' ? f.Size * 0.5f : g.MeasureString(s, f, PointF.Empty, StringFormat.GenericTypographic).Width) + f.Size * 0.14f;
            }
        }

        readonly Dictionary<Color, SolidBrush> brushes = new Dictionary<Color, SolidBrush>();
        SolidBrush Brush(Color c) => brushes.TryGetValue(c, out var b) ? b : brushes[c] = new SolidBrush(c);
        static Color Hex(string h) => Color.FromArgb(Convert.ToInt32(h.Substring(0, 2), 16), Convert.ToInt32(h.Substring(2, 2), 16), Convert.ToInt32(h.Substring(4, 2), 16));
    }
}
