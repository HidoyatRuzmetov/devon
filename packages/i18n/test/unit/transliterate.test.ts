import { describe, expect, it } from 'vitest'
import { latinToCyrillic } from '../../src/transliterate.js'

// This is a mechanical first pass (see the module's own header comment) -- native review is out of
// scope for this epic (ac.md). These assertions pin known-correct outputs, cross-checked against
// real government text fetched for terms.json (packages/i18n/TERMS.md), so a future refactor cannot
// silently regress the cases that are already right.
describe('latinToCyrillic (mechanical Uzbek Latin -> Cyrillic transliteration)', () => {
  it('maps the seed terminology words exactly as they appear in the sourced government text', () => {
    expect(latinToCyrillic('Vazifa')).toBe('Вазифа')
    expect(latinToCyrillic('Topshiriq')).toBe('Топшириқ')
    expect(latinToCyrillic('Muddat')).toBe('Муддат')
    expect(latinToCyrillic('Boʻlim')).toBe('Бўлим')
    expect(latinToCyrillic('Xodim')).toBe('Ходим')
    expect(latinToCyrillic('Tadbir')).toBe('Тадбир')
    expect(latinToCyrillic('Tasdiqlash')).toBe('Тасдиқлаш')
    expect(latinToCyrillic('Bekor qilish')).toBe('Бекор қилиш')
    expect(latinToCyrillic('Saqlash')).toBe('Сақлаш')
    expect(latinToCyrillic('Boshqaruv')).toBe('Бошқарув')
  })

  it('handles the sh/ch/ng digraphs, and h on its own (Uzbek h -> ҳ, not the Cyrillic х)', () => {
    expect(latinToCyrillic('sahifa')).toBe('саҳифа') // no "sh" digraph here (s-a-h-i-f-a): sanity check for bare h
    expect(latinToCyrillic('shahar')).toBe('шаҳар')
    expect(latinToCyrillic('kitob')).toBe('китоб')
    expect(latinToCyrillic('choy')).toBe('чой')
    expect(latinToCyrillic('rang')).toBe('ранг')
  })

  it('maps the oʻ / gʻ digraphs (both the modifier letter and a bare ASCII apostrophe)', () => {
    expect(latinToCyrillic('oʻzbek')).toBe('ўзбек')
    expect(latinToCyrillic("o'zbek")).toBe('ўзбек')
    expect(latinToCyrillic('gʻalaba')).toBe('ғалаба')
  })

  it('word-initial or post-vowel e is э; post-consonant e is е', () => {
    expect(latinToCyrillic('elektron')).toBe('электрон')
    expect(latinToCyrillic('bekor')).toBe('бекор')
    expect(latinToCyrillic('reja')).toBe('режа')
  })

  it('word-initial or post-vowel y+vowel is iotated (я/е/ё/ю); post-consonant y is separate й', () => {
    expect(latinToCyrillic('yakka')).toBe('якка')
    expect(latinToCyrillic('yordam')).toBe('ёрдам')
    expect(latinToCyrillic('Rahbar yakka oʻzi')).toBe('Раҳбар якка ўзи')
  })

  it('the tutuq belgisi (hamza apostrophe) becomes ъ', () => {
    expect(latinToCyrillic("ma'no")).toBe('маъно')
    expect(latinToCyrillic("san'at")).toBe('санъат')
  })

  it('preserves the case pattern: capitalised word, ALL CAPS word, lower-case word', () => {
    expect(latinToCyrillic('Bosh')).toBe('Бош')
    expect(latinToCyrillic('BOSH')).toBe('БОШ')
    expect(latinToCyrillic('bosh')).toBe('бош')
    expect(latinToCyrillic('Sh')).toBe('Ш')
  })

  it('passes digits and punctuation through unchanged', () => {
    expect(latinToCyrillic('2026-yil')).toBe('2026-йил')
  })

  // Regression: `yo` (iotated ё) and `oʻ` (ў) overlap across the two match tiers, and the iotated
  // one used to win -- turning "yoʻq", the word in half the product's empty states, into "ёъқ",
  // which is not a word. It is й + ў: two letters, not one iotated vowel.
  it('reads yoʻ as y + oʻ (йў), never as the iotated yo (ёъ)', () => {
    expect(latinToCyrillic('yoʻq')).toBe('йўқ')
    expect(latinToCyrillic('yoʻl')).toBe('йўл')
    expect(latinToCyrillic('yoʻnalish')).toBe('йўналиш')
    expect(latinToCyrillic('yoʻqotish')).toBe('йўқотиш')
    // The bare ASCII apostrophe spelling of the same digraph, which this file also accepts.
    expect(latinToCyrillic("yo'q")).toBe('йўқ')
    // Case is still carried across the two letters it now produces instead of one.
    expect(latinToCyrillic('Yoʻq')).toBe('Йўқ')
    expect(latinToCyrillic('YOʻQ')).toBe('ЙЎҚ')
  })

  it('still iotates yo when no modifier letter follows, and keeps yaʼ iotated', () => {
    expect(latinToCyrillic('yosh')).toBe('ёш')
    expect(latinToCyrillic('quyosh')).toBe('қуёш')
    // "yaʼni" -- the apostrophe here is the tutuq belgisi on `ya`, not part of a `aʻ` digraph, so
    // the narrow guard above must not touch it.
    expect(latinToCyrillic('yaʼni')).toBe('яъни')
  })
})
