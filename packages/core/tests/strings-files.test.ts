/* Strings out to a file and back. The failure that matters is silent: a file
 * that looks right, imports without complaint, and puts the wrong sentence on
 * the wrong screen. */

import { describe, expect, test } from 'bun:test';
import type { ProjectDoc } from '../src/index';
import { parseStrings, stringUnits, writeStrings } from '../src/index';

function project(): ProjectDoc {
  return {
    schema: 1,
    id: 'p',
    name: 'P',
    createdAt: '',
    updatedAt: '',
    kit: {
      preset: 'none',
      base: '',
      sheets: {},
      themes: { dark: { label: 'Dark', tokens: {} } },
      defaultTheme: 'dark',
      fonts: [],
    },
    items: {
      home: {
        tier: 'screen',
        html:
          '<h1 data-t="home.title">Your projects</h1>' +
          '<button class="btn primary" data-t="home.brief">Brief</button>' +
          '<p data-t="home.note">Comma, and "quotes" inside.</p>',
        props: {},
        fixtures: { default: { values: {} } },
      },
      detail: {
        tier: 'screen',
        // The same word again, on a different screen: this is what dedupe is for.
        html: '<span data-t="detail.brief">Brief</span>',
        props: {},
        fixtures: { default: { values: {} } },
      },
    },
    flow: { nodes: {}, edges: {}, groups: [] },
    strings: {
      defaultLocale: 'en',
      locales: {
        en: { label: 'English', entries: { 'home.title': 'STALE — not what the screen says' } },
        ru: { label: 'Russian', entries: { 'home.title': 'Ваши проекты' } },
      },
    },
    assets: {},
    viewports: [{ id: 'mobile', label: 'Mobile', device: 'mobile', width: 390, height: 844 }],
  };
}

describe('reading strings out of a project', () => {
  /* For the default language the markup IS the text — `localize` substitutes
     nothing — so an entry that has drifted is a stale copy. Sending a
     translator a sentence that is no longer on screen is the one failure this
     must not have. */
  test('the source text comes from the markup, not from the entries', () => {
    const units = stringUnits(project());
    const title = units.find((u) => u.keys.includes('home.title'));

    expect(title?.source).toBe('Your projects');
    expect(title?.source).not.toContain('STALE');
  });

  test('it says where each string is used', () => {
    const units = stringUnits(project());
    const brief = units.find((u) => u.keys.includes('home.brief'));

    expect(brief?.uses[0]).toEqual({ item: 'home', tag: 'button', classes: 'btn primary' });
  });

  test('an existing translation comes along', () => {
    const units = stringUnits(project(), { locale: 'ru' });
    expect(units.find((u) => u.keys.includes('home.title'))?.target).toBe('Ваши проекты');
  });

  test('deduplicating groups identical text and keeps every key', () => {
    const units = stringUnits(project(), { dedupe: true });
    const brief = units.find((u) => u.source === 'Brief');

    expect(brief?.keys.sort()).toEqual(['detail.brief', 'home.brief']);
    expect(units.filter((u) => u.source === 'Brief')).toHaveLength(1);
  });

  test('a key whose element was deleted is not silently dropped', () => {
    const doc = project();
    doc.strings.locales.en = { label: 'English', entries: { 'gone.key': 'Removed screen' } };

    expect(stringUnits(doc).some((u) => u.keys.includes('gone.key'))).toBe(true);
  });
});

describe('json — for an application', () => {
  const json = (locale: string) =>
    JSON.parse(
      writeStrings(stringUnits(project(), { locale }), {
        format: 'json',
        locale,
        sourceLocale: 'en',
      }),
    ) as Record<string, string>;

  test('the source language is every key, key for key', () => {
    const out = json('en');

    expect(out['home.title']).toBe('Your projects');
    expect(out['home.brief']).toBe('Brief');
    expect(out['detail.brief']).toBe('Brief');
  });

  /* The renderer falls back per key, so a file that filled the gaps with
     English would behave differently from the canvas. */
  test('a target language omits what is not translated', () => {
    const out = json('ru');

    expect(out['home.title']).toBe('Ваши проекты');
    expect('home.brief' in out).toBe(false);
  });
});

describe('csv — for a person', () => {
  const csv = () =>
    writeStrings(stringUnits(project(), { locale: 'ru', dedupe: true }), {
      format: 'csv',
      locale: 'ru',
      sourceLocale: 'en',
    });

  test('it carries source, target and where the string lives', () => {
    const text = csv();
    expect(text.split('\n')[0]).toBe('key,source,target,screens,element');
    expect(text).toContain('Ваши проекты');
    expect(text).toContain('"button.btn, span"');
  });

  test('commas and quotes survive the trip', () => {
    const known = new Set(stringUnits(project()).flatMap((u) => u.keys));
    const text = csv().replace(',,detail home,', ',TRANSLATED,detail home,');

    // The awkward field is quoted on the way out and read back whole.
    expect(text).toContain('"Comma, and ""quotes"" inside."');
    expect(parseStrings(text, 'csv', known).entries['home.title']).toBe('Ваши проекты');
  });

  test('a deduplicated row puts its translation on every key it names', () => {
    const known = new Set(stringUnits(project()).flatMap((u) => u.keys));
    const filled = csv().replace(
      /^(detail\.brief home\.brief|home\.brief detail\.brief),Brief,,/m,
      '$1,Brief,Бриф,',
    );
    const { entries } = parseStrings(filled, 'csv', known);

    expect(entries['home.brief']).toBe('Бриф');
    expect(entries['detail.brief']).toBe('Бриф');
  });
});

describe('xliff — for an agency', () => {
  const xliff = () =>
    writeStrings(stringUnits(project(), { locale: 'ru', dedupe: true }), {
      format: 'xliff',
      locale: 'ru',
      sourceLocale: 'en',
    });

  test('it declares both languages and pairs source with target', () => {
    const text = xliff();

    expect(text).toContain('srcLang="en"');
    expect(text).toContain('trgLang="ru"');
    expect(text).toContain('<source>Your projects</source>');
    expect(text).toContain('<target>Ваши проекты</target>');
  });

  /* A deduplicated unit covers several places: "Brief" is a button on one
     screen and a span on another, and naming only one of them tells the
     translator something true in one place and misleading in the rest. */
  test('a translator sees every form the string takes', () => {
    expect(xliff()).toContain('<note category="element">button.btn, span</note>');
    expect(xliff()).toContain('<note category="element">h1</note>');
  });

  test('it round-trips through its own parser', () => {
    const known = new Set(stringUnits(project()).flatMap((u) => u.keys));
    const { entries } = parseStrings(xliff(), 'xliff', known);

    expect(entries['home.title']).toBe('Ваши проекты');
  });

  /* An agency's tool rewrites the file — reordering units, splitting segments,
     moving the notes. Reading only the shape we wrote would lose the work. */
  test('it survives a file that has been through somebody else’s tool', () => {
    const known = new Set(stringUnits(project()).flatMap((u) => u.keys));
    const rewritten = `<?xml version="1.0"?>
<xliff version="2.0" srcLang="en" trgLang="ru">
  <file id="whatever">
    <unit id="home.title" other="attribute">
      <segment state="translated">
        <source>Your projects</source>
        <target>Наши проекты</target>
      </segment>
    </unit>
  </file>
</xliff>`;

    expect(parseStrings(rewritten, 'xliff', known).entries['home.title']).toBe('Наши проекты');
  });

  test('escaped characters come back as characters', () => {
    const known = new Set(['home.note']);
    const file = `<xliff><unit id="home.note"><segment>
      <source>x</source><target>Comma, &amp; &quot;quotes&quot; &lt;here&gt;</target>
    </segment></unit></xliff>`;

    expect(parseStrings(file, 'xliff', known).entries['home.note']).toBe(
      'Comma, & "quotes" <here>',
    );
  });
});

describe('taking a file back', () => {
  const known = () => new Set(stringUnits(project()).flatMap((u) => u.keys));

  /* A returned file has usually been through somebody else's tool, and an
     invented key written into the document would be invisible. */
  test('keys the project does not have are reported, not written', () => {
    const { entries, unknown } = parseStrings(
      '{"home.title":"Ваши проекты","invented.key":"Nope"}',
      'json',
      known(),
    );

    expect(entries).toEqual({ 'home.title': 'Ваши проекты' });
    expect(unknown).toEqual(['invented.key']);
  });

  test('an empty target is left alone rather than blanking the text', () => {
    const { entries } = parseStrings('{"home.title":""}', 'json', known());
    expect(entries).toEqual({});
  });

  test('a CSV with no target column says so instead of importing nothing', () => {
    expect(() => parseStrings('key,source\na,b\n', 'csv', known())).toThrow(/target/);
  });
});
