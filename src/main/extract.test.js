const test = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const { htmlToText, readHtml, readMhtml, readPptx } = require('./extract');

test('web pages keep their text and lose scripts, menus and tags', () => {
  const text = htmlToText(
    '<head><title>no</title></head><nav>Menu</nav><script>alert("x")</script><!-- hidden -->' +
      '<h1>Cells &amp; energy</h1><p title="a > b">If x < 5,\n then caf&eacute; &#233; &#x3B1;.</p><footer>Contact</footer>',
  );
  assert.equal(text, 'Cells & energy\n\nIf x < 5, then café é α.');
});

test('the main content area wins when it holds the text', () => {
  const body = 'Mitochondria make most of the usable energy in a cell. '.repeat(10);
  const text = htmlToText(`<div>Course list</div><main><p>${body}</p></main>`);
  assert.ok(!text.includes('Course list'));
  assert.ok(htmlToText(`<main>tiny</main><div>${body}</div>`).includes('Mitochondria'));
});

test('saved pages are read in their declared character set', () => {
  assert.equal(readHtml(Buffer.from('<meta charset="windows-1252"><p>caf\xe9</p>', 'latin1')), 'café');
});

test('single-file saved pages decode their HTML part', () => {
  const file = [
    'MIME-Version: 1.0',
    'Content-Type: multipart/related;',
    '\tboundary="----Part--1"',
    '',
    '------Part--1',
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<p class=3D"x">Een caf=C3=A9 met een lange re=',
    'gel</p>',
    '------Part--1',
    'Content-Type: text/css',
    '',
    'p { color: red }',
    '------Part--1--',
  ].join('\r\n');
  assert.equal(readMhtml(Buffer.from(file, 'latin1')), 'Een café met een lange regel');
});

test('slides come out in presentation order with their speaker notes', async () => {
  const zip = new JSZip();
  const slide = (...runs) => `<p:sld>${runs.map((r) => `<a:p><a:r><a:t>${r}</a:t></a:r></a:p>`).join('')}<a:p><a:fld type="slidenum"><a:t>9</a:t></a:fld></a:p></p:sld>`;
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://x/${type}" Target="${target}"/>`;
  // The file names run the other way round from the order in the presentation.
  zip.file('ppt/presentation.xml', '<p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst>');
  zip.file('ppt/_rels/presentation.xml.rels', rel('rId1', 'slide', 'slides/slide1.xml') + rel('rId2', 'slide', 'slides/slide2.xml'));
  zip.file('ppt/slides/slide1.xml', slide('Second &amp; last'));
  zip.file('ppt/slides/slide2.xml', slide('First'));
  zip.file('ppt/slides/_rels/slide2.xml.rels', rel('rId1', 'notesSlide', '../notesSlides/notesSlide1.xml'));
  zip.file('ppt/notesSlides/notesSlide1.xml', slide('Say this aloud'));
  const text = await readPptx(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(text, 'Slide 1\nFirst\nSpeaker notes:\nSay this aloud\n\nSlide 2\nSecond & last');
});

test('a file that is not a presentation is refused', async () => {
  await assert.rejects(readPptx(Buffer.from('nonsense')));
});
