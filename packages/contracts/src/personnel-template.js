// Layout authority: the annotated Эшматов Word sample supplied on 2026-11-04.
// The user's later instruction overrides its employment dates: years only.

/* Маълумотнома generator: builds a .docx (Office Open XML) with no libraries.
   Layout mirrors the reference file: Times New Roman 11, margins 1.5/1/1/2 cm. */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function clean(s) {
  return String(s == null ? '' : s)
    .replace(/\s+/g, ' ')
    .trim()
}

/* ---------- small WordprocessingML helpers ---------- */
function rpr(o) {
  o = o || {}
  var x = ''
  if (o.b) x += '<w:b/><w:bCs/>'
  var sz = o.sz || 22
  x += '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>'
  return '<w:rPr>' + x + '</w:rPr>'
}
/* Quotation marks in the document: “...” (« » are only used inside the form's logic). */
function displayQuotes(s) {
  return String(s == null ? '' : s)
}
function run(text, o) {
  var parts = displayQuotes(text)
    .replace(/(\d)-(?=[A-Za-zА-Яа-яЁёЎўҚқҒғҲҳ])/g, '$1\u0001')
    .split('\u0001')
  return (
    '<w:r>' +
    rpr(o) +
    parts
      .map(function (t) {
        return '<w:t xml:space="preserve">' + esc(t) + '</w:t>'
      })
      .join('<w:noBreakHyphen/>') +
    '</w:r>'
  )
}
function tabRun(o) {
  return '<w:r>' + rpr(o) + '<w:tab/></w:r>'
}
function para(inner, o) {
  o = o || {}
  var p = ''
  if (o.keepNext) p += '<w:keepNext/>'
  if (o.tabs)
    p +=
      '<w:tabs>' +
      o.tabs
        .map(function (t) {
          return '<w:tab w:val="left" w:pos="' + t + '"/>'
        })
        .join('') +
      '</w:tabs>'
  if (o.before || o.after)
    p += '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after || 0) + '"/>'
  var ind = ''
  if (o.left != null) ind += ' w:left="' + o.left + '"'
  if (o.right != null) ind += ' w:right="' + o.right + '"'
  if (o.hanging != null) ind += ' w:hanging="' + o.hanging + '"'
  if (ind) p += '<w:ind' + ind + '/>'
  if (o.jc) p += '<w:jc w:val="' + o.jc + '"/>'
  p += rpr({ sz: o.sz || 22, b: o.b })
  return '<w:p><w:pPr>' + p + '</w:pPr>' + (inner || '') + '</w:p>'
}
function empty(sz) {
  return para('', { sz: sz || 22 })
}

var COL2 = 4228 // measured tab stop in the authoritative Word sample (twips)
var PHOTO_GAP = 1204 // right indent next to the photo

function labelPair(a, b) {
  return para(run(a, { b: true }) + (b ? tabRun() + run(b, { b: true }) : ''), {
    tabs: [COL2],
    before: 160,
    keepNext: true,
  })
}
function valuePair(a, bLines) {
  bLines = bLines && bLines.length ? bLines : ['']
  var out = ''
  bLines.forEach(function (line, i) {
    var inner = (i === 0 ? run(a) : '') + tabRun() + run(line)
    out += para(inner, { tabs: [COL2], left: COL2, hanging: COL2 })
  })
  return out
}
function labelBlock(label, value) {
  return para(run(label, { b: true }), { before: 160, keepNext: true }) + para(run(value || 'йўқ'))
}

/* ---------- formatting of values ---------- */
function fmtDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  return m ? m[3] + '.' + m[2] + '.' + m[1] : clean(iso)
}
function fmtSince(iso) {
  var m = /^(\d{4})(?:-\d{2}-\d{2})?$/.exec(iso || '')
  if (!m) return ''
  return m[1] + ' йилдан:'
}
function eduLines(schools) {
  var list = (schools || []).filter(function (s) {
    return clean(s.name)
  })
  return list.map(function (s, i) {
    var inPar = []
    if (s.master) inPar.push('магистратура')
    if (clean(s.form)) inPar.push(clean(s.form))
    var t =
      (clean(s.year) ? clean(s.year) + ' й. ' : '') +
      clean(s.name) +
      (inPar.length ? ' (' + inPar.join(', ') + ')' : '')
    return t + (i < list.length - 1 ? ',' : '')
  })
}
function workStartYear(w) {
  return /^\d{4}$/.test(clean(w.from))
    ? clean(w.from)
    : w.current
      ? (w.since || '').slice(0, 4)
      : clean(w.from)
}
function workPeriod(w) {
  var from = workStartYear(w),
    to = clean(w.to)
  if (w.current) return from + ' й. - ҳ.в.'
  if (!to) return from + ' й.'
  return from + '-' + to + ' йй.'
}
function workLine(w) {
  return workPeriod(w) + ' - ' + clean(w.text)
}

function relWorkLines(r) {
  var prev = clean(r.prevJob)
    .replace(/^\(+\s*/, '')
    .replace(/\s*\)+$/, '')
  switch (r.status) {
    case 'retired':
      return ['Пенсияда', prev ? '(' + prev + ')' : '']
    case 'unemployed':
      return ['Вақтинча ишламайди', prev ? '(' + prev + ')' : '']
    case 'dead':
      return [clean(r.deathYear) + ' йил вафот этган', prev ? '(' + prev + ')' : '']
    case 'housewife':
      return ['Уй бекаси']
    default:
      return [clean(r.job)]
  }
}
function relBirthLines(r) {
  var parts = relativeBirthPlace(r)
    .split(/\s*,\s*/)
    .filter(Boolean)
  var lines = clean(r.year) ? [clean(r.year) + ' йил' + (parts.length ? ',' : '')] : []
  parts.forEach(function (p, i) {
    lines.push(p + (i < parts.length - 1 ? ',' : ''))
  })
  return lines
}
// Older imported drafts sometimes kept the birth year in both fields. Remove only
// the exact matching year prefix; never strip years occurring inside a place name.
function relativeBirthPlace(r) {
  var place = clean(r.place),
    year = clean(r.year)
  if (!/^\d{4}$/.test(year)) return place
  var prefix = new RegExp(
    '^' +
      year +
      '(?!\\d)\\s*[-–]?\\s*(?:йил(?:и)?|й\\.|yil(?:i)?|y\\.|год(?:а)?|г\\.)?\\s*[,;:]?\\s*',
    'i',
  )
  while (prefix.test(place)) place = place.replace(prefix, '')
  return place
}

/* ---------- Uzbek Latin -> Cyrillic (runs in the browser, no internet) ---------- */
var APOS = "'ʻʼ‘’`"
var VOWELS = 'aeiouAEIOU'
function matchCase(src, cyr) {
  if (src === src.toUpperCase() && src !== src.toLowerCase()) {
    // all caps ("SH") or single capital ("S") -> capital first letter
    return src.length > 1 && src[1] === src[1].toUpperCase() && /[a-z]/i.test(src[1])
      ? cyr.toUpperCase()
      : cyr.charAt(0).toUpperCase() + cyr.slice(1)
  }
  if (src.charAt(0) !== src.charAt(0).toLowerCase())
    return cyr.charAt(0).toUpperCase() + cyr.slice(1)
  return cyr
}
var SINGLE = {
  a: 'а',
  b: 'б',
  d: 'д',
  e: 'е',
  f: 'ф',
  g: 'г',
  h: 'ҳ',
  i: 'и',
  j: 'ж',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'қ',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  x: 'х',
  y: 'й',
  z: 'з',
  c: 'ц',
  w: 'в',
}
/* Words where Latin "s"/"ts" is Cyrillic "ц" (common in job and company names). */
var TS_WORDS = [
  [/^aksiya/i, 'акция'],
  [/^stansiya/i, 'станция'],
  [/^sirk/i, 'цирк'],
  [/^sement/i, 'цемент'],
  [/^sentr/i, 'центр'],
  [/^sex(?=$|i|lar|da|ning)/i, 'цех'],
  [/^litsey/i, 'лицей'],
  [/^politsiya/i, 'полиция'],
  [/^militsiya/i, 'милиция'],
  [/^kvitansiya/i, 'квитанция'],
  [/^konsert/i, 'концерт'],
  [/^inspeksiya/i, 'инспекция'],
  [/^inspektsiya/i, 'инспекция'],
  [/^prokuratura/i, 'прокуратура'],
  [/^kansler/i, 'канцлер'],
  [/^fransiya/i, 'франция'],
]
function latinWord(w) {
  for (var k = 0; k < TS_WORDS.length; k++) {
    var mm = TS_WORDS[k][0].exec(w)
    if (mm)
      return (
        matchCase(mm[0], TS_WORDS[k][1]) +
        (w.length > mm[0].length ? latinWord(w.slice(mm[0].length)) : '')
      )
  }
  var tsi = /tsiya/i.exec(w)
  if (tsi && tsi.index > 0)
    return (
      latinWord(w.slice(0, tsi.index)) +
      matchCase(tsi[0], 'ция') +
      latinWord(w.slice(tsi.index + 5))
    )
  var out = '',
    i = 0
  while (i < w.length) {
    var ch = w[i],
      lo = ch.toLowerCase(),
      nx = w[i + 1] || '',
      nlo = nx.toLowerCase(),
      prev = i > 0 ? w[i - 1] : ''
    // o' g'  (oʻ gʻ)
    if ((lo === 'o' || lo === 'g') && nx && APOS.indexOf(nx) >= 0) {
      out += matchCase(ch, lo === 'o' ? 'ў' : 'ғ')
      i += 2
      continue
    }
    // s'h -> сҳ (Is'hoq)
    if (lo === 's' && APOS.indexOf(nx) >= 0 && (w[i + 2] || '').toLowerCase() === 'h') {
      out += matchCase(ch, 'с') + matchCase(w[i + 2], 'ҳ')
      i += 3
      continue
    }
    if (
      lo === 't' &&
      nlo === 's' &&
      prev &&
      VOWELS.indexOf(prev) >= 0 &&
      /i/i.test(w[i + 2] || '')
    ) {
      out += matchCase(ch, 'ц')
      i += 2
      continue
    }
    if (lo === 's' && nlo === 'h') {
      out += matchCase(ch + nx, 'ш')
      i += 2
      continue
    }
    if (lo === 'c' && nlo === 'h') {
      out += matchCase(ch + nx, 'ч')
      i += 2
      continue
    }
    if (lo === 'y' && /[oaue]/.test(nlo) && !(nlo === 'o' && APOS.indexOf(w[i + 2] || '') >= 0)) {
      var m = { o: 'ё', a: 'я', u: 'ю', e: 'е' }[nlo]
      out += matchCase(ch + nx, m)
      i += 2
      continue
    }
    if (APOS.indexOf(ch) >= 0) {
      out += prev && /[a-z]/i.test(prev) ? 'ъ' : ch
      i++
      continue
    }
    if (lo === 'e') {
      var start = i === 0 || !/[a-z]/i.test(prev)
      out += matchCase(ch, start || VOWELS.indexOf(prev) >= 0 ? 'э' : 'е')
      i++
      continue
    }
    if (SINGLE[lo]) {
      out += matchCase(ch, SINGLE[lo])
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}
function _hasLatin(s) {
  return /[A-Za-z]/.test(
    String(s || '')
      .replace(/«[^»]*»/g, '')
      .replace(/"[^"]*"/g, ''),
  )
}
/* Converts Latin Uzbek to Cyrillic. Text inside «...» or "..." (company names) is kept as typed. */
/* Uzbek (not English) text inside quotes: o'/g' letters or typical Uzbek word endings. */
var ENGLISH =
  /\b(telecom|group|systems?|electronics?|solutions?|company|international|services?|tech|technology|digital|global|invest|trade|trading|consulting|agency|food|foods|motors?|pharm|pharma|plus|holding|logistics|media|soft|software|capital|finance|energy|construction|development|market|store|shop|express|auto|medical|clinic|hotel|travel|education|academy|school|center|centre|club|studio|design|partners|business|bank|life|family|choice|world|city|house|home|smart|pro|max|light|star|line|net|online|mobile)\b/i
/* Uzbek (not English) text inside quotes: Uzbek word endings or oʻ/gʻ inside words, and no English words. */
function looksUzbek(s) {
  if (ENGLISH.test(s)) return false
  return (
    /[oOgG][ʻʼ‘’'`](?![sS]\b)[A-Za-z]/.test(s) ||
    /[a-z](si|lari|larini|ligi|ligini|dagi|ning|iston|viloyati|tumani|shahri|markazi|jamiyati|vazirligi|universiteti|instituti|korxonasi|muassasasi|boshqarmasi|qo'mitasi|agentligi|bo'limi|banki|xizmati)\b/i.test(
      s,
    )
  )
}

/* Latin text that stays Latin (company names): oʻ gʻ get ‘, the other apostrophe gets ’. */
function latinApostrophes(s) {
  return String(s)
    .replace(/([oOgG])['ʻʼ‘’`](?![sS]\b)(?=[A-Za-z])/g, '$1‘')
    .replace(/([A-Za-z])['ʼ’`‘](?=[A-Za-z])/g, function (m, c, off, str) {
      return str[off + 1] === '‘' && /[oOgG]/.test(c) ? m : c + '’'
    })
}
function unifyQuotes(s) {
  return String(s == null ? '' : s).replace(/["“„”]\s*([^"“„”]+?)\s*["”“]/g, '«$1»')
}
function toCyrillic(s) {
  s = unifyQuotes(s)
  return s
    .split(/(«[^»]*»)/)
    .map(function (part) {
      if (/^«/.test(part) && !looksUzbek(part)) return latinApostrophes(part)
      return part
        .replace(/[A-Za-z'ʻʼ‘’`]+/g, function (w) {
          return /[A-Za-z]/.test(w) ? latinWord(w) : w
        })
        .replace(/([А-Яа-яЁёЎўҚқҒғҲҳ])['ʻʼ‘’`](?=[А-Яа-яЁёЎўҚқҒғҲҳ])/g, '$1ъ') // Cyrillic: Ма'лумот -> Маълумот
        .replace(/ъ(?=\s|$)/g, '')
    })
    .join('')
}

/* Short forms of organisation types, written out in full automatically. */
var EXPAND = [
  ['МЧЖ', 'масъулияти чекланган жамияти'],
  ['ОАЖ', 'очиқ акциядорлик жамияти'],
  ['ЁАЖ', 'ёпиқ акциядорлик жамияти'],
  ['АЖ', 'акциядорлик жамияти'],
  ['ДУК', 'давлат унитар корхонаси'],
  ['МФЙ', 'маҳалла фуқаролар йиғини'],
  ['ҚФЙ', 'қишлоқ фуқаролар йиғини'],
  ['ЯТТ', 'якка тартибдаги тадбиркор'],
  ['АК', 'акциядорлик компанияси'],
  ['ХК', 'хусусий корхонаси'],
]
function expandShort(s) {
  return String(s == null ? '' : s)
    .split(/(«[^»]*»|"[^"]*")/)
    .map(function (part) {
      if (/^[«"]/.test(part)) return part
      EXPAND.forEach(function (e) {
        part = part.replace(new RegExp('(^|[\\s,(])' + e[0] + '(?=[\\s,.)]|$)', 'gi'), '$1' + e[1])
      })
      return part
    })
    .join('')
}

/* Copy of the form data with every text converted to Cyrillic and names capitalised. */
function cap1(s) {
  s = String(s || '')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function capName(s) {
  return String(s || '')
    .split(/(\s+)/)
    .map(function (w) {
      if (/^[ўуо]([ғг]{1,2}л?и|л?ғи)$/i.test(w)) return 'ўғли' // ўғли, ўгли, огли, угли, ўғи, Ўғли ...
      if (/^[қк]изи$/i.test(w)) return 'қизи' // қизи, кизи, Қизи
      return cap1(w.toLowerCase())
    })
    .join('')
}

/* Common misspellings, corrected automatically (whole words). */
var SPELL = [
  ['шахар', 'шаҳар'],
  ['шахри', 'шаҳри'],
  ['шахридаги', 'шаҳридаги'],
  ['шахарча', 'шаҳарча'],
  ['шахарчаси', 'шаҳарчаси'],
  ['харбий', 'ҳарбий'],
  ['мутахасис', 'мутахассис'],
  ['мутахасиси', 'мутахассиси'],
  ['мутахасислиги', 'мутахассислиги'],
  ['телекомуникация', 'телекоммуникация'],
  ['телекомуникациялар', 'телекоммуникациялар'],
  ['телекомуникациялари', 'телекоммуникациялари'],
  ['ходимилар', 'ходимлар'],
  ['хокимлиги', 'ҳокимлиги'],
  ['хокимияти', 'ҳокимияти'],
  ['махалла', 'маҳалла'],
  ['махалласи', 'маҳалласи'],
  ['кучаси', 'кўчаси'],
  ['бўлини', 'бўлими'],
]
function fixSpelling(s) {
  return String(s || '').replace(/[А-Яа-яЁёЎўҚқҒғҲҳ]+/g, function (w) {
    var lo = w.toLowerCase()
    for (var i = 0; i < SPELL.length; i++)
      if (SPELL[i][0] === lo) return w[0] !== lo[0] ? cap1(SPELL[i][1]) : SPELL[i][1]
    return w
  })
}

/* Text typed in CAPITALS -> normal writing; known proper names keep a capital letter. */
var PROPER = [
  'ўзбекистон',
  'тошкент',
  'самарқанд',
  'бухоро',
  'андижон',
  'наманган',
  'фарғона',
  'хоразм',
  'навоий',
  'қашқадарё',
  'сурхондарё',
  'жиззах',
  'сирдарё',
  'қорақалпоғистон',
  'нукус',
  'термиз',
  'қарши',
  'урганч',
  'гулистон',
  'қўқон',
  'марғилон',
  'чирчиқ',
  'олмалиқ',
  'ангрен',
  'бекобод',
  'мирзо',
  'улуғбек',
  'муҳаммад',
  'мухаммад',
  'хоразмий',
  'амир',
  'темур',
  'алишер',
  'беруний',
  'форобий',
  'ибн',
  'сино',
  'бобур',
  'олий',
  'мажлис',
  'президент',
]
function isProper(lo) {
  for (var i = 0; i < PROPER.length; i++) if (lo.indexOf(PROPER[i]) === 0) return true
  return false
}
var CAPW = '[0-9]*-?[А-ЯЁЎҚҒҲ][А-ЯЁЎҚҒҲ0-9-]*[А-ЯЁЎҚҒҲ]'
function decaps(s) {
  s = String(s || '')
  // every run of 3 or more words written fully in capitals
  s = s.replace(new RegExp('(«?' + CAPW + '»?)(\\s+«?' + CAPW + '»?){2,}', 'g'), function (run) {
    return (
      run
        .replace(new RegExp(CAPW, 'g'), function (w) {
          var lo = w.toLowerCase()
          return isProper(lo) ? cap1(lo) : lo
        })
        // a word in front of «тумани», «шаҳри», «кўчаси» ... is a place name
        .replace(
          /(^|[\s,«])([а-яёўқғҳ]+)(?=\s+(тумани|туман|шаҳри|шаҳар|вилояти|маҳалласи|кўчаси|қишлоғи|массиви|мавзеси)(\s|,|$))/g,
          function (m, pre, w) {
            return pre + cap1(w)
          },
        )
    )
  })
  // official naming habits
  s = s
    .replace(/ўзбекистон\s+республикаси(\s+)([а-яёўқғҳ])/gi, function (m, sp, c) {
      return 'Ўзбекистон Республикаси' + sp + c.toUpperCase()
    })
    .replace(/ўзбекистон\s+республикаси/gi, 'Ўзбекистон Республикаси')
    .replace(/(ҳузуридаги\s+)([а-яёўқғҳ])/g, function (m, a, c) {
      return a + c.toUpperCase()
    })
    .replace(/(^|[\s«])ал[\s-]+хоразмий/gi, '$1ал-Хоразмий')
  return cap1(s).replace(/«([а-яёўқғҳa-z])/g, function (m, c) {
    return '«' + c.toUpperCase()
  })
}
/* Words with a capital letter in the middle of a name that should not have one ("Тошкент Ахборот Технологиялари"). */
var GENERIC =
  /^(давлат|миллий|ахборот|технологиялари|технология|университети|университет|институти|институт|академияси|коллежи|техникуми|лицейи|мактаби|тиббиёт|иқтисодиёт|иқтисодий|педагогика|педагогик|техника|архитектура|қурилиш|қишлоқ|хўжалиги|инженерлик|филиали|жаҳон|тиллари|санъат|маданият|юридик|бўлими|бошқармаси|банки|жамияти|корхонаси|маркази|ҳокимлиги|кафедраси|факультети|мутахассиси|бош|етакчи|раҳбари|директори|ўқитувчиси|талабаси|молия|ҳуқуқ|ҳуқуқшунослик|ихтисослаштирилган|касб-ҳунар|касб|ҳунар|ўрта|махсус|олий|таълим|ташкилоти)$/i
/* Ordinary words written with a capital letter in the middle of a name ("Тошкент Ахборот Технологиялари"). */
function extraCapitals(s) {
  var out = [],
    prev = ''
  String(s || '')
    .replace(/«[^»]*»/g, ' ')
    .split(/\s+/)
    .forEach(function (w, i) {
      if (
        i > 0 &&
        /^[А-ЯЁЎҚҒҲ][а-яёўқғҳ]/.test(w) &&
        GENERIC.test(w) &&
        !/(республикаси|ҳузуридаги)$/i.test(prev) &&
        !(/^олий$/i.test(w) && /^мажлис/i.test(''))
      )
        out.push(w)
      prev = w
    })
  return out
}

/* Places and addresses: commas between parts, "493 уй" -> "493-уй", capitals. */
function fixPlace(s) {
  s = String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(/[А-ЯЁЎҚҒҲ]{2,}[а-яёўқғҳ]+/g, function (w) {
    return cap1(w.toLowerCase())
  }) // ТАрнов -> Тарнов
  s = s.replace(
    /(вилояти|тумани|шаҳри|маҳалласи|кўчаси|қишлоғи|йиғини|мавзеси|массиви|шаҳарчаси| овули)(?=\s+[^\s,])/gi,
    '$1,',
  )
  s = s.replace(/(\d+[А-Яа-я]?)\s*-?\s*(уй|хонадон)(?=[\s,.]|$)/gi, function (m, n, w) {
    return n.toUpperCase() + '-' + w.toLowerCase()
  })
  return capPlace(s)
}
function capPlace(s) {
  return String(s || '')
    .split(/(,\s*)/)
    .map(function (p) {
      return /^,/.test(p) ? p : cap1(p)
    })
    .join('')
}

/* Languages: "рус энг" -> "рус, инглиз тиллари". */
var LANGS = [
  [/^(рус|русча|рус тили|russian|ruscha)$/i, 'рус'],
  [/^(инглиз|инглизча|энг|eng|english|англ|английский)$/i, 'инглиз'],
  [/^(немис|немисча|german|nemis)$/i, 'немис'],
  [/^(француз|французча|french)$/i, 'француз'],
  [/^(корейс|корейсча|korean)$/i, 'корейс'],
  [/^(турк|туркча|turkish)$/i, 'турк'],
  [/^(хитой|хитойча|chinese)$/i, 'хитой'],
  [/^(япон|японча|japanese)$/i, 'япон'],
  [/^(араб|арабча|arabic)$/i, 'араб'],
  [/^(испан|испанча|spanish)$/i, 'испан'],
  [/^(италян|итальян|италянча|italian)$/i, 'итальян'],
  [/^(форс|форсча|persian)$/i, 'форс'],
  [/^(ҳинд|хинд|hindi)$/i, 'ҳинд'],
]
function fixLanguages(s) {
  s = clean(s)
  if (!s || /^йўқ$/i.test(s)) return s
  var toks = s
    .toLowerCase()
    .split(/[\s,;/]+|\bва\b/)
    .filter(function (t) {
      return t && !/^(тили|тиллари|тилини|тилларини|ва|билади)$/.test(t)
    })
  var out = [],
    unknown = false
  toks.forEach(function (t) {
    var hit = null
    LANGS.forEach(function (l) {
      if (!hit && l[0].test(t)) hit = l[1]
    })
    if (hit) {
      if (out.indexOf(hit) < 0) out.push(hit)
    } else unknown = true
  })
  if (unknown || !out.length) return s
  return out.join(', ') + (out.length > 1 ? ' тиллари' : ' тили')
}

/* Copy of the form data, cleaned the way the official document needs it. */
function normalize(d) {
  function conv(v) {
    if (typeof v === 'string') return fixSpelling(expandShort(toCyrillic(v)))
    if (Array.isArray(v)) return v.map(conv)
    if (v && typeof v === 'object' && !(v instanceof Uint8Array)) {
      var o = {}
      for (var k in v) o[k] = k === 'photo' || k === 'status' ? v[k] : conv(v[k])
      return o
    }
    return v
  }
  var n = conv(d)
  n.fio = capName(n.fio)
  n.birthPlace = fixPlace(n.birthPlace)
  n.nationality = clean(n.nationality).toLowerCase()
  var sp = clean(decaps(n.specialty))
  n.specialty =
    /^[А-ЯЁЎҚҒҲ][а-яёўқғҳ]/.test(sp) && !isProper(sp.split(' ')[0].toLowerCase())
      ? sp.charAt(0).toLowerCase() + sp.slice(1)
      : sp
  n.languages = fixLanguages(n.languages)
  ;(n.schools || []).forEach(function (s) {
    s.name = cap1(decaps(s.name))
  })
  ;(n.work || []).forEach(function (w) {
    w.text = cap1(decaps(w.text))
  })
  ;(n.relatives || []).forEach(function (r) {
    r.name = capName(r.name)
    r.place = fixPlace(r.place)
    r.address = fixPlace(r.address)
    r.job = cap1(decaps(r.job))
    r.prevJob = cap1(decaps(r.prevJob))
  })
  return n
}

/* The current job (ҳ.в.) shown under the name. */
function currentJob(d) {
  var cur = (d.work || []).filter(function (w) {
    return w.current && clean(w.text)
  })
  return cur.length ? cur[cur.length - 1] : null
}

/* ---------- table ---------- */
var GRID = [1260, 2160, 1980, 2860, 2267]
var BORDER =
  '<w:tcBorders>' +
  ['top', 'left', 'bottom', 'right']
    .map(function (s) {
      return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
    })
    .join('') +
  '</w:tcBorders>'
function cell(w, lines, bold, span) {
  lines = (lines || ['']).filter(function (l, i) {
    return l !== '' || i === 0
  })
  var ps = lines
    .map(function (l) {
      return (
        '<w:p><w:pPr><w:jc w:val="center"/>' +
        (w === GRID[0] ? '<w:ind w:left="-108" w:right="-108"/>' : '') +
        rpr({ b: bold }) +
        '</w:pPr>' +
        (l ? run(l, { b: bold }) : '') +
        '</w:p>'
      )
    })
    .join('')
  return (
    '<w:tc><w:tcPr><w:tcW w:w="' +
    w +
    '" w:type="dxa"/>' +
    (span ? '<w:gridSpan w:val="' + span + '"/>' : '') +
    BORDER +
    '<w:vAlign w:val="center"/></w:tcPr>' +
    ps +
    '</w:tc>'
  )
}
function row(cells, header) {
  return (
    '<w:tr><w:trPr><w:cantSplit/>' +
    (header ? '<w:tblHeader/>' : '') +
    '<w:jc w:val="center"/></w:trPr>' +
    cells.join('') +
    '</w:tr>'
  )
}
function relTable(rels) {
  var x =
    '<w:tbl><w:tblPr><w:tblW w:w="10527" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/>' +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' +
    GRID.map(function (g) {
      return '<w:gridCol w:w="' + g + '"/>'
    }).join('') +
    '</w:tblGrid>'
  x += row(
    [
      cell(GRID[0], ['Қариндош-', 'лиги'], true),
      cell(GRID[1], ['Фамилияси, исми', 'ва отасининг исми'], true),
      cell(GRID[2], ['Туғилган йили', 'ва жойи'], true),
      cell(GRID[3], ['Иш жойи ва лавозими'], true),
      cell(GRID[4], ['Турар жойи'], true),
    ],
    true,
  )
  rels.forEach(function (r) {
    x += row([
      cell(GRID[0], [clean(r.rel)], true),
      cell(GRID[1], [clean(r.name)]),
      cell(GRID[2], relBirthLines(r)),
      ...(r.status === 'dead'
        ? [cell(GRID[3] + GRID[4], relWorkLines(r), false, 2)]
        : [cell(GRID[3], relWorkLines(r)), cell(GRID[4], [clean(r.address)])]),
    ])
  })
  return x + '</w:tbl>'
}

/* ---------- photo (anchored top-right, 3x4) ---------- */
function photoRun() {
  var cx = 1080000,
    cy = 1440000 // exactly 3 x 4 cm
  return (
    '<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>5122545</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>-5080</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="' +
    cx +
    '" cy="' +
    cy +
    '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="left"/>' +
    '<wp:docPr id="1" name="Фото"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="photo.jpeg"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdPhoto"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' +
    cx +
    '" cy="' +
    cy +
    '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
  )
}

/* ---------- document body ---------- */
function documentXml(d) {
  var fio = clean(d.fio)
  var b = ''
  b += para((d.photo ? photoRun() : '') + run('МАЪЛУМОТНОМА', { b: true, sz: 28 }), {
    jc: 'center',
    right: PHOTO_GAP,
    sz: 28,
  })
  b += empty(16)
  b += para(run(fio, { b: true, sz: 28 }), { jc: 'center', right: PHOTO_GAP, sz: 28 })
  b += empty(24)
  b += empty(24)
  var cj = currentJob(d)
  if (cj) {
    var since = fmtSince(workStartYear(cj))
    if (since) b += para(run(since), { right: 2547, keepNext: true })
    b += para(run(clean(cj.text), { b: true }), { right: 2547, b: true })
  }
  b +=
    labelPair('Туғилган йили:', 'Туғилган жойи:') +
    valuePair(fmtDate(d.birthDate), [clean(d.birthPlace)])
  b +=
    labelPair('Миллати:', 'Партиявийлиги:') +
    valuePair(clean(d.nationality), [clean(d.party) || 'йўқ'])
  b += labelPair('Маълумоти:', 'Тамомлаган:') + valuePair(clean(d.eduLevel), eduLines(d.schools))
  b += para(
    run('Маълумоти бўйича мутахассислиги:', { b: true }) +
      tabRun() +
      run(clean(d.specialty) || 'йўқ'),
    { tabs: [COL2], left: COL2, hanging: COL2, before: 160 },
  )
  b +=
    labelPair('Илмий даражаси:', 'Илмий унвони:') +
    valuePair(clean(d.degree) || 'йўқ', [clean(d.title) || 'йўқ'])
  b +=
    labelPair('Қайси чет тилларини билади:', 'Ҳарбий унвони:') +
    valuePair(clean(d.languages), [clean(d.militaryRank)])
  b += labelBlock('Давлат мукофотлари билан тақдирланганми (қанақа):', clean(d.awards))
  b += para(
    run(
      'Халқ депутатлари республика, вилоят, шаҳар ва туман Кенгаши депутатими ёки бошқа сайланадиган органларнинг аъзосими (тўлиқ кўрсатилиши лозим):',
      { b: true },
    ),
    { before: 160, keepNext: true },
  )
  b += para(run(clean(d.deputy) || 'йўқ'), { left: 1414, hanging: 1414 })
  b += empty(16)
  b += para(run('МЕҲНАТ ФАОЛИЯТИ', { b: true, sz: 28 }), { jc: 'center', sz: 28, keepNext: true })
  b += empty(16)
  ;(d.work || [])
    .filter(function (w) {
      return clean(w.text)
    })
    .forEach(function (w) {
      b += para(run(workPeriod(w) + ' -') + tabRun() + run(clean(w.text)), {
        after: 80,
        tabs: [1486],
        left: 1486,
        hanging: 1486,
      })
    })
  b += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
  b += para(run(fio + 'нинг яқин қариндошлари ҳақида', { b: true, sz: 24 }), {
    jc: 'center',
    sz: 24,
  })
  b += para(run('МАЪЛУМОТ', { b: true, sz: 24 }), { jc: 'center', sz: 24 })
  b += empty(24)
  b += relTable(
    (d.relatives || []).filter(function (r) {
      return clean(r.name)
    }),
  )
  b += empty(6)
  b +=
    '<w:sectPr><w:pgSz w:w="11905" w:h="16837"/><w:pgMar w:top="851" w:right="567" w:bottom="567" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>'
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' +
    b +
    '</w:body></w:document>'
  )
}

var STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="uz-Cyrl-UZ" w:eastAsia="ru-RU" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:widowControl w:val="0"/><w:suppressAutoHyphens/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>' +
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  '</w:styles>'
var SETTINGS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="708"/>' +
  '<w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'

function contentTypes(hasPhoto) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (hasPhoto ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : '') +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>'
  )
}
var ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>'
function docRels(hasPhoto) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
    (hasPhoto
      ? '<Relationship Id="rIdPhoto" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.jpeg"/>'
      : '') +
    '</Relationships>'
  )
}
function core() {
  var now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<dc:title>МАЪЛУМОТНОМА</dc:title><dc:creator></dc:creator>' +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' +
    now +
    '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' +
    now +
    '</dcterms:modified>' +
    '</cp:coreProperties>'
  )
}

/* ---------- minimal ZIP writer (stored, no compression) ---------- */
var CRC_TABLE = (function () {
  var t = new Uint32Array(256)
  for (var n = 0; n < 256; n++) {
    var c = n
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(u8) {
  var c = 0xffffffff
  for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function utf8(s) {
  return new TextEncoder().encode(s)
}
function zip(files) {
  var chunks = [],
    central = [],
    offset = 0
  var d = new Date()
  var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  files.forEach(function (f) {
    var name = utf8(f.name),
      data = typeof f.data === 'string' ? utf8(f.data) : f.data
    var crc = crc32(data)
    var h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, 0x04034b50, true)
    h.setUint16(4, 20, true)
    h.setUint16(6, 0x0800, true)
    h.setUint16(8, 0, true)
    h.setUint16(10, dosTime, true)
    h.setUint16(12, dosDate, true)
    h.setUint32(14, crc, true)
    h.setUint32(18, data.length, true)
    h.setUint32(22, data.length, true)
    h.setUint16(26, name.length, true)
    h.setUint16(28, 0, true)
    chunks.push(new Uint8Array(h.buffer), name, data)
    var c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint16(10, 0, true)
    c.setUint16(12, dosTime, true)
    c.setUint16(14, dosDate, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    central.push(new Uint8Array(c.buffer), name)
    offset += 30 + name.length + data.length
  })
  var cdSize = central.reduce(function (s, a) {
    return s + a.length
  }, 0)
  var e = new DataView(new ArrayBuffer(22))
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, files.length, true)
  e.setUint16(10, files.length, true)
  e.setUint32(12, cdSize, true)
  e.setUint32(16, offset, true)
  var all = chunks.concat(central, [new Uint8Array(e.buffer)])
  var total = all.reduce(function (s, a) {
    return s + a.length
  }, 0)
  var out = new Uint8Array(total),
    p = 0
  all.forEach(function (a) {
    out.set(a, p)
    p += a.length
  })
  return out
}

function buildDocx(d, options = {}) {
  d = options.normalized ? d : normalize(d)
  var hasPhoto = !!(d.photo && d.photo.length)
  var files = [
    { name: '[Content_Types].xml', data: contentTypes(hasPhoto) },
    { name: '_rels/.rels', data: ROOT_RELS },
    {
      name: 'word/document.xml',
      data: options.transformText
        ? documentXml(d).replace(
            /(<w:t(?: [^>]*)?>)([^<]*)(<\/w:t>)/g,
            function (_, open, text, close) {
              const decoded = text
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
              return open + esc(options.transformText(decoded)) + close
            },
          )
        : documentXml(d),
    },
    { name: 'word/_rels/document.xml.rels', data: docRels(hasPhoto) },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/settings.xml', data: SETTINGS },
    { name: 'docProps/core.xml', data: core() },
  ]
  if (hasPhoto) files.push({ name: 'word/media/photo.jpeg', data: d.photo })
  return zip(files)
}

/* File name rule: full name in Cyrillic, ў/қ/ғ/ҳ replaced by у/к/г/х */
function fileName(fio) {
  var map = { ў: 'у', Ў: 'У', қ: 'к', Қ: 'К', ғ: 'г', Ғ: 'Г', ҳ: 'х', Ҳ: 'Х' }
  var n = clean(fio)
    .replace(/[ўЎқҚғҒҳҲ]/g, function (c) {
      return map[c]
    })
    .replace(/[\\/:*?"<>|]/g, '')
  return (n || 'Маълумотнома') + '.docx'
}

/* ---------- rule checks (from the official notes) ---------- */
var LETTERS = 'А-Яа-яЁёЎўҚқҒғҲҳ'
var ABBR = new RegExp('(^|[\\s,(«"])([' + LETTERS + ']{1,5})\\.(?=[\\s,)»"]|\\d|$)', 'g')
var ACRONYM = /(^|[\s(«"])([А-ЯЁЎҚҒҲ]{2,5}|[А-ЯЁЎҚҒҲ][а-яёўқғҳ]{1,4}[А-ЯЁЎҚҒҲ]{1,3})(?=[\s,.)»"]|$)/
function findAbbr(s, allowed) {
  var m,
    found = []
  ABBR.lastIndex = 0
  while ((m = ABBR.exec(s))) {
    if (allowed && allowed.indexOf(m[2].toLowerCase()) >= 0) continue
    found.push(m[2] + '.')
  }
  if (/ҳ\.в\./i.test(s) && !(allowed && allowed.indexOf('ҳ.в') >= 0)) found.push('ҳ.в.')
  return found
}

var MALE_REL = ['Отаси', 'Акаси', 'Укаси', 'Ўғли', 'Қайнотаси']
var FEMALE_REL = ['Онаси', 'Опаси', 'Синглиси', 'Қизи', 'Қайнонаси']
var UNIQUE_REL = ['Отаси', 'Онаси', 'Турмуш ўртоғи', 'Қайнотаси', 'Қайнонаси']
var PARENT_REL = ['Отаси', 'Онаси']
var CHILD_REL = ['Ўғли', 'Қизи']
/* Guess gender from patronymic (sure) or surname ending (likely). */
function genderOf(name) {
  var w = clean(name).split(' ')
  var rest = w.slice(1).join(' ')
  if (/(овна|евна|ична|қизи)$/i.test(rest)) return { g: 'f', sure: true }
  if (/(ович|евич|ич|ўғли)$/i.test(rest)) return { g: 'm', sure: true }
  if (/(ова|ева|ина)$/i.test(w[0] || '')) return { g: 'f', sure: false }
  if (/(ов|ев|ин)$/i.test(w[0] || '')) return { g: 'm', sure: false }
  return null
}

var ORG_END =
  /(институти|университети|академияси|коллежи|лицейи|мактаби|техникуми|корхонаси|муассасаси|маркази|жамияти|вазирлиги|қўмитаси|агентлиги|бошқармаси|ҳокимлиги|ҳокимияти|банки|филиали|инспекцияси|хизмати|бўлими|кафедраси|факультети|бирлашмаси|уюшмаси|ташкилоти|компанияси|заводи|фабрикаси|комбинати|идораси|палатаси|суди|прокуратураси|шифохонаси|поликлиникаси|касалхонаси|департаменти|дирекцияси|концерни|холдинги|кластери|фирмаси|»)$/i
function noPosition(s) {
  return ORG_END.test(clean(s).replace(/[.,;]+$/, ''))
}
/* Root of a first name or patronymic, for comparing "Сагдулло" with "Сагдуллаевич" / "Сағдулло ўғли". */
function nameRoot(s) {
  return clean(s)
    .toLowerCase()
    .replace(/ғ/g, 'г')
    .replace(/ҳ/g, 'х')
    .replace(/ў/g, 'у')
    .replace(/қ/g, 'к')
    .replace(/ё/g, 'е')
    .replace(/(ович|евич|овна|евна|ична|ич)$/, '')
    .replace(/[аоеиуыэюя]+$/, '')
}
function looseRoot(s) {
  return nameRoot(s)
}
function exactRoot(s) {
  return clean(s)
    .toLowerCase()
    .replace(/(ович|евич|овна|евна|ична|ич)$/, '')
    .replace(/[аоеиуыэюяў]+$/, '')
}
function parts(full) {
  var w = clean(full).split(' ')
  var last = w[w.length - 1] || ''
  if (/^(ўғли|қизи)$/i.test(last))
    return { surname: w[0] || '', first: w[1] || '', patr: w.slice(2, -1).join(' '), suffix: last }
  return { surname: w[0] || '', first: w[1] || '', patr: w.slice(2).join(' '), suffix: '' }
}

function validate(d) {
  d = normalize(d)
  var errors = [],
    warnings = []
  function jobStyle(id, label, s) {
    s = clean(s)
    if (!s) return
    var q =
      /[«"“„]([^»"”]+)[»"”]\s+((?:кафедра|бўлим|факультет|сектор|бошқарма|лаборатория|марказ)[а-яўқғҳ]*)/i.exec(
        s,
      )
    if (q)
      err(
        id,
        label +
          ': бўлинма номи қўштирноқсиз ва кичик ҳарф билан ёзилади: «' +
          q[1].toLowerCase() +
          ' ' +
          q[2] +
          '».',
      )
    var n = /([А-ЯЁЎҚҒҲа-яёўқғҳ]+(?:и|си))нинг\s/.exec(s)
    if (n)
      warn(
        id,
        label + ': «-нинг» қўшимчаси ишлатилмайди: «' + n[0].trim() + '» эмас, «' + n[1] + '».',
      )
  }
  function issueTarget(id) {
    var match = /^(school|work|rel)-(\d+)\.(\w+)$/.exec(id)
    var lists = { school: 'schools', work: 'work', rel: 'relatives' }
    if (match)
      return {
        id: match[1] + '-' + match[2],
        path: lists[match[1]] + '.' + match[2] + '.' + match[3],
      }
    var first = { schools: 'schools.0.name', work: 'work.0.text', relatives: 'relatives.0.name' }
    return { id: id, path: first[id] || id }
  }
  function err(id, msg) {
    errors.push({
      ...issueTarget(id),
      msg: msg,
      missing: /(тўлдирилмаган|танланмаган|кўрсатилмаган)\.$/.test(msg),
    })
  }
  function warn(id, msg) {
    warnings.push({ ...issueTarget(id), msg: msg })
  }
  function latinCheck() {
    return false
  }
  function abbrCheck(id, label, s, allowed, strict) {
    s = clean(s)
    if (!s) return false
    var bad = latinCheck(id, label, s)
    var a = findAbbr(s, allowed)
    if (a.length) {
      err(id, label + ': қисқартириш ишлатилган («' + a.join('», «') + '»). Сўзни тўлиқ ёзинг.')
      bad = true
    }
    var ac = ACRONYM.exec(s.replace(/«[^»]*»/g, ''))
    if (ac) {
      if (strict) {
        err(id, label + ': «' + ac[2] + '» қисқартмаси ишлатилмайди. Тўлиқ номини ёзинг.')
        bad = true
      } else warn(id, label + ': «' + ac[2] + '» қисқартмаси. Иложи бўлса тўлиқ номини ёзинг.')
    }
    return bad
  }
  function nameCheck(id, label, s, strict) {
    s = clean(s)
    if (!s) {
      err(id, label + ': тўлдирилмаган.')
      return
    }
    if (/\./.test(s)) {
      err(id, label + ': инициаллар ишлатилмайди. Исм ва отасининг исмини тўлиқ ёзинг.')
      return
    }
    var words = s.split(' ')
    if (
      words.some(function (w) {
        return w.replace(new RegExp('[^' + LETTERS + ']', 'g'), '').length === 1
      })
    )
      err(id, label + ': бир ҳарфли сўз бор. Тўлиқ ёзинг.')
    if (words.length < 3)
      (strict ? err : warn)(id, label + ': фамилия, исм ва отасининг исми тўлиқ кўрсатилиши керак.')
  }
  function placeCheck(id, label, s) {
    s = clean(s)
    if (!s) {
      err(id, label + ': тўлдирилмаган.')
      return
    }
    if (abbrCheck(id, label, s, null, true)) return
    if (/(кўча|уй\b|-уй|хонадон|маҳалла|мавзе|массив|тор кўча|шаҳарча|\d)/i.test(s))
      err(
        id,
        label +
          ': бу ерга фақат вилоят ва туман (шаҳар) ёзилади. Кўча ва уй рақами «Турар жойи»га ёзилади.',
      )
    else if (!/(туман|шаҳ(ар|ри))/i.test(s))
      warn(id, label + ': туман ёки шаҳар номи кўрсатилмаган (масалан, «Қибрай тумани»).')
  }
  function yearOk(v) {
    return /^\d{4}$/.test(clean(v))
  }
  var yr = new Date().getFullYear()
  var by = /^(\d{4})/.exec(d.birthDate || '')
  by = by ? +by[1] : null

  /* 1. Personal */
  nameCheck('fio', 'Ф.И.Ш.', d.fio, true)
  if (!clean(d.photo)) err('photo', 'Фото киритилмаган.')
  if (clean(d.photoError)) err('photo', 'Фото: ' + clean(d.photoError))
  if (!d.birthDate) err('birthDate', 'Туғилган санаси тўлдирилмаган.')
  else {
    var birth = new Date(d.birthDate + 'T00:00:00Z')
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(d.birthDate) ||
      !Number.isFinite(birth.getTime()) ||
      birth.toISOString().slice(0, 10) !== d.birthDate ||
      by < 1930 ||
      by > yr - 14
    )
      err('birthDate', 'Туғилган санасини текширинг.')
  }
  placeCheck('birthPlace', 'Туғилган жойи', d.birthPlace)
  if (!clean(d.nationality)) err('nationality', 'Миллати тўлдирилмаган.')
  else latinCheck('nationality', 'Миллати', d.nationality)
  latinCheck('party', 'Партиявийлиги', d.party)

  /* 2. Education */
  if (!clean(d.eduLevel)) err('eduLevel', 'Маълумоти танланмаган.')
  var schools = (d.schools || []).filter(function (s) {
    return clean(s.name) || clean(s.year)
  })
  if (clean(d.eduLevel) && !/^ўрта$/.test(clean(d.eduLevel)) && !schools.length)
    err('schools', 'Тамомлаган ўқув юрти кўрсатилмаган.')
  schools.forEach(function (s) {
    var index = d.schools.indexOf(s),
      id = 'school-' + index,
      lab = 'Тамомлаган (' + (index + 1) + ')'
    if (!yearOk(s.year)) err(id + '.year', lab + ': тамомлаган йилини 4 рақам билан ёзинг.')
    else if (by && +s.year < by + 15)
      warn(id + '.year', lab + ': тамомлаган йили туғилган йилга тўғри келмайди. Текширинг.')
    else if (+s.year > yr + 6) err(id + '.year', lab + ': тамомлаган йилини текширинг.')
    var xc = extraCapitals(s.name)
    if (xc.length >= 2)
      warn(
        id + '.name',
        lab +
          ': номда ортиқча бош ҳарфлар бор («' +
          xc.join('», «') +
          '»). Диплом бўйича ёзинг, масалан: «Тошкент ахборот технологиялари университети».',
      )
    if (!clean(s.name)) err(id + '.name', lab + ': ўқув юрти номи тўлдирилмаган.')
    else if (
      !abbrCheck(id + '.name', lab, s.name, null, true) &&
      clean(s.name).split(' ').length < 2
    )
      warn(id + '.name', lab + ': ўқув юртининг номини диплом бўйича тўлиқ ёзинг.')
    if (!clean(s.form) && !s.master) err(id + '.form', lab + ': таълим шаклини танланг.')
  })
  abbrCheck('specialty', 'Мутахассислиги', d.specialty, null, true)
  if (
    /(университет|институт|коллеж|академия|лицей|талаба|магистрант|аспирант)/i.test(
      clean(d.specialty),
    )
  )
    err(
      'specialty',
      'Мутахассислиги: бу ерга ўқув юрти эмас, диплом бўйича мутахассислик ёзилади (масалан, «иқтисодчи», «дастурий инжиниринг»).',
    )

  /* 3. Other */
  if (!clean(d.militaryRank))
    err('militaryRank', 'Ҳарбий унвони тўлдирилмаган. Унвон бўлмаса, «йўқ» деб ёзинг.')
  var lang = clean(d.languages)
  latinCheck('languages', 'Чет тиллари', lang)
  if (/(қозоқ|қирғиз|тожик|туркман)/i.test(lang))
    warn(
      'languages',
      'Қўшни давлат тиллари ёзилмайди. Фақат мукаммал биладиган тилларни қолдиринг.',
    )
  ;['degree', 'title', 'militaryRank', 'awards', 'deputy'].forEach(function (k) {
    abbrCheck(k, 'Майдон', d[k], ['й'])
  })

  /* 4. Work history */
  var work = (d.work || []).filter(function (w) {
    return clean(w.text) || clean(w.from)
  })
  if (!work.length) err('work', 'Меҳнат фаолияти тўлдирилмаган.')
  work.forEach(function (w) {
    var index = d.work.indexOf(w),
      id = 'work-' + index,
      lab = 'Меҳнат фаолияти (' + (index + 1) + ')'
    var startYear = workStartYear(w)
    if (!yearOk(startYear)) err(id + '.from', lab + ': бошланган йилни 4 рақам билан ёзинг.')
    else {
      if (by && +w.from < by + 14)
        warn(id + '.from', lab + ': бошланган йил туғилган йилга тўғри келмайди. Текширинг.')
      if (+w.from > yr) err(id + '.from', lab + ': бошланган йил келажакда.')
    }
    if (!w.current && clean(w.to) && !yearOk(w.to))
      err(id + '.to', lab + ': тугаган йилни 4 рақам билан ёзинг.')
    if (!w.current && yearOk(w.to) && yearOk(w.from) && +w.to < +w.from)
      err(id + '.to', lab + ': тугаган йил бошланган йилдан олдин.')
    if (!clean(w.text)) err(id + '.text', lab + ': иш жойи ва лавозими тўлдирилмаган.')
    abbrCheck(id + '.text', lab, w.text)
    jobStyle(id + '.text', lab, w.text)
    var xcw = extraCapitals(w.text)
    if (xcw.length >= 2)
      warn(
        id + '.text',
        lab +
          ': ортиқча бош ҳарфлар бор («' +
          xcw.join('», «') +
          '»). Бош ҳарф фақат номнинг биринчи сўзида ва жой номларида ёзилади.',
      )
    if (clean(w.text) && noPosition(w.text))
      err(
        id + '.text',
        lab +
          ': лавозими кўрсатилмаган. Ташкилот номидан кейин лавозимни ёзинг (масалан, «... бош мутахассиси» ёки «... талабаси»).',
      )
  })

  var spans = work
    .filter(function (w) {
      return yearOk(w.from)
    })
    .map(function (w) {
      var to = w.current ? yr : yearOk(w.to) ? +w.to : +w.from
      return { from: +w.from, to: to }
    })
    .sort(function (a, b) {
      return a.from - b.from
    })
  for (var gi = 1; gi < spans.length; gi++) {
    var end = Math.max.apply(
      null,
      spans.slice(0, gi).map(function (s) {
        return s.to
      }),
    )
    if (spans[gi].from - end > 1)
      warn(
        'work',
        'Меҳнат фаолиятида узилиш бор: ' +
          end +
          '–' +
          spans[gi].from +
          ' йиллар кўрсатилмаган. Агар ишламаган бўлсангиз ҳам, бу даврни текширинг.',
      )
  }

  /* 5. Relatives */
  var rels = (d.relatives || []).filter(function (r) {
    return clean(r.name) || clean(r.year) || clean(r.address)
  })
  if (!rels.length) err('relatives', 'Яқин қариндошлар кўрсатилмаган.')
  var seen = {}
  rels.forEach(function (r) {
    var index = d.relatives.indexOf(r),
      id = 'rel-' + index,
      rel = clean(r.rel),
      lab = (rel || 'Қариндош') + ' (' + (index + 1) + '-қатор)'
    if (!rel) err(id + '.rel', lab + ': қариндошлиги танланмаган.')
    if (UNIQUE_REL.indexOf(rel) >= 0) {
      if (seen[rel]) err(id + '.rel', lab + ': «' + rel + '» икки марта кўрсатилган.')
      seen[rel] = true
    }
    nameCheck(id + '.name', lab, r.name, false)
    var gd = genderOf(r.name)
    if (gd && rel) {
      var want = MALE_REL.indexOf(rel) >= 0 ? 'm' : FEMALE_REL.indexOf(rel) >= 0 ? 'f' : null
      if (want && gd.g !== want) {
        ;(gd.sure ? err : warn)(
          id + '.name',
          lab +
            ': исм-шарифи ' +
            (gd.g === 'f' ? 'аёл' : 'эркак') +
            ' кишиники, қариндошлиги эса «' +
            rel +
            '». Қариндошлик ёки исмни текширинг.',
        )
      }
    }
    if (!yearOk(r.year) || +r.year < 1900 || +r.year > yr)
      err(id + '.year', lab + ': туғилган йилини 4 рақам билан ёзинг.')
    else if (by) {
      if (PARENT_REL.indexOf(rel) >= 0 && +r.year > by - 14)
        err(
          id + '.year',
          lab +
            ': туғилган йили сизнинг туғилган йилингизга тўғри келмайди (' +
            r.year +
            ' ва ' +
            by +
            '). Текширинг.',
        )
      if (CHILD_REL.indexOf(rel) >= 0 && +r.year < by + 14)
        err(
          id + '.year',
          lab +
            ': туғилган йили сизнинг туғилган йилингизга тўғри келмайди (' +
            r.year +
            ' ва ' +
            by +
            '). Текширинг.',
        )
    }
    placeCheck(id + '.place', lab + ', туғилган жойи', r.place)
    if (!clean(r.status)) err(id + '.status', lab + ': ҳозирги ҳолатини танланг.')
    var prev = ['retired', 'dead', 'unemployed'].indexOf(r.status) >= 0 ? clean(r.prevJob) : '',
      job = (r.status || 'work') === 'work' ? clean(r.job) : ''
    if (r.status !== 'work' && /^уй бекаси$/i.test(prev))
      err(
        id + '.prevJob',
        lab + ': «Ҳозирги ҳолати»дан «Уй бекаси»ни танланг (у «Вақтинча ишламайди» эмас).',
      )
    if (r.status !== 'work' && prev && noPosition(prev))
      err(
        id + '.prevJob',
        lab + ': аввалги лавозими кўрсатилмаган. Ташкилот номидан кейин лавозимни ёзинг.',
      )
    var rp = parts(r.name)
    if (clean(r.name).split(' ').length >= 3 && !rp.suffix && !/(вич|вна|ична)$/i.test(rp.patr))
      warn(
        id + '.name',
        lab +
          ': отасининг исми тўлиқ эмас («' +
          rp.patr +
          '»). Масалан, «Раимович», «Раимовна» ёки «Раим ўғли».',
      )
    if (r.status !== 'work' && /(пенсия|вафот|ишламайди)/i.test(prev))
      err(
        id + '.prevJob',
        lab +
          ': «Аввалги иш жойи» майдонига фақат лавозим ёзилади («Пенсияда», «вафот этган» сўзларисиз). Бу сўзлар файлга ўзи қўшилади.',
      )
    if (r.status !== 'work' && /^\(|\)$/.test(prev))
      warn(id + '.prevJob', lab + ': қавс ёзиш шарт эмас, у файлга ўзи қўйилади.')
    if (/(илгари|бўлган)/i.test(prev) || /(илгари|бўлган)/i.test(job))
      err(
        id + (r.status === 'work' ? '.job' : '.prevJob'),
        lab +
          ': «илгари», «бўлган» сўзларисиз ёзинг. Аввалги лавозимни қавс ичида тўлиқ кўрсатинг.',
      )
    if (r.status === 'work') {
      if (!job) err(id + '.job', lab + ': иш жойи ва лавозими тўлдирилмаган.')
      else {
        if (/^\(.*\)$/.test(job))
          err(
            id + '.job',
            lab +
              ': лавозим қавс ичида ёзилган. Агар пенсияда, ишламайди ёки вафот этган бўлса, «Ҳозирги ҳолати»дан танланг; қавс ўзи қўйилади.',
          )
        if (/(пенсия|нафақа|вафот)/i.test(job))
          err(id + '.job', lab + ': «Ҳозирги ҳолати»дан «Пенсияда» ёки «Вафот этган»ни танланг.')
        if (/ишламайди/i.test(job))
          err(id + '.job', lab + ': «Ҳозирги ҳолати»дан «Вақтинча ишламайди»ни танланг.')
        var jobBad = /^\(.*\)$/.test(job) || /(пенсия|нафақа|вафот|ишламайди)/i.test(job)
        if (!jobBad && job.split(' ').length < 2 && !/[A-Za-z]/.test(job))
          warn(id + '.job', lab + ': иш жойи ва лавозимини тўлиқ ёзинг.')
      }
      abbrCheck(id + '.job', lab, job)
      jobStyle(id + '.job', lab, job)
      if (job && noPosition(job))
        err(id + '.job', lab + ': лавозими кўрсатилмаган. Ташкилот номидан кейин лавозимни ёзинг.')
      if (/^уй бекаси$/i.test(job))
        err(id + '.job', lab + ': «Ҳозирги ҳолати»дан «Уй бекаси»ни танланг.')
    } else if (r.status === 'retired' || r.status === 'dead') {
      if (!prev)
        err(id + '.prevJob', lab + ': аввалги иш жойи ва лавозими тўлиқ кўрсатилиши керак.')
      abbrCheck(id + '.prevJob', lab, prev.replace(/^\(|\)$/g, ''))
    } else abbrCheck(id + '.prevJob', lab, prev.replace(/^\(|\)$/g, ''))
    if (r.status === 'dead') {
      if (!yearOk(r.deathYear)) err(id + '.deathYear', lab + ': вафот этган йилини кўрсатинг.')
      else if (+r.deathYear < +r.year || +r.deathYear > yr)
        err(id + '.deathYear', lab + ': вафот этган йилини текширинг.')
    } else {
      var a = clean(r.address)
      if (!a) err(id + '.address', lab + ': турар жойи тўлдирилмаган.')
      else {
        abbrCheck(id + '.address', lab + ', турар жойи', a, ['уй'], true)
        if (!/(вилоят|шаҳри|Қорақалпоғистон)/i.test(a))
          warn(id + '.address', lab + ': турар жойида вилоят ёки шаҳар номи тўлиқ кўрсатилмаган.')
        if (!/уй/i.test(a))
          warn(id + '.address', lab + ': турар жойида уй рақами кўрсатилмаган (масалан, «5-уй»).')
      }
    }
  })
  /* names must agree with each other */
  var me = parts(d.fio),
    fatherRow = -1,
    fil = -1,
    spouseRow = -1
  rels.forEach(function (r, i) {
    if (r.rel === 'Отаси') fatherRow = i
    if (r.rel === 'Қайнотаси') fil = i
    if (r.rel === 'Турмуш ўртоғи') spouseRow = i
  })
  function agree(id, label, a, aLabel, b, bLabel) {
    if (!clean(a) || !clean(b)) return
    if (exactRoot(a) === exactRoot(b)) return
    if (looseRoot(a) === looseRoot(b))
      err(
        id,
        label +
          ': ' +
          aLabel +
          ' «' +
          a +
          '», ' +
          bLabel +
          ' эса «' +
          b +
          '». Иккаласи бир хил ёзилиши керак (паспорт бўйича).',
      )
    else
      warn(id, label + ': ' + aLabel + ' «' + a + '», ' + bLabel + ' эса «' + b + '». Текширинг.')
  }
  if (fatherRow >= 0)
    agree(
      'rel-' + d.relatives.indexOf(rels[fatherRow]) + '.name',
      'Отаси',
      parts(rels[fatherRow].name).first,
      'отангизнинг исми',
      me.patr,
      'Ф.И.Ш.ингизда',
    )
  rels.forEach(function (r) {
    if (['Акаси', 'Укаси', 'Опаси', 'Синглиси'].indexOf(r.rel) >= 0)
      agree(
        'rel-' + d.relatives.indexOf(r) + '.name',
        r.rel + ' (' + (d.relatives.indexOf(r) + 1) + '-қатор)',
        parts(r.name).patr,
        'унинг отасининг исми',
        me.patr,
        'сизнинг Ф.И.Ш.ингизда',
      )
    if (CHILD_REL.indexOf(r.rel) >= 0 && genderOf(d.fio) && genderOf(d.fio).g === 'm')
      agree(
        'rel-' + d.relatives.indexOf(r) + '.name',
        r.rel + ' (' + (d.relatives.indexOf(r) + 1) + '-қатор)',
        parts(r.name).patr,
        'фарзандингизнинг отасининг исми',
        me.first,
        'сизнинг исмингиз',
      )
  })
  if (fil >= 0 && spouseRow >= 0)
    agree(
      'rel-' + d.relatives.indexOf(rels[spouseRow]) + '.name',
      'Турмуш ўртоғи',
      parts(rels[spouseRow].name).patr,
      'турмуш ўртоғингизнинг отасининг исми',
      parts(rels[fil].name).first,
      'қайнотангизнинг исми',
    )
  var langRaw = clean(d.languages)
  if (langRaw && !/^йўқ$/i.test(langRaw) && !/тил(и|лари)$/.test(langRaw))
    warn('languages', 'Тилларни тўлиқ ёзинг, масалан: «рус, инглиз тиллари».')

  if (rels.length && !seen['Отаси'])
    warn('relatives', 'Отаси кўрсатилмаган. Вафот этган бўлса ҳам ёзилади.')
  var uniq = {}
  errors = errors.filter(function (e) {
    var k = e.id + '|' + e.msg
    if (uniq[k]) return false
    uniq[k] = 1
    return true
  })
  if (rels.length && !seen['Онаси'])
    warn('relatives', 'Онаси кўрсатилмаган. Вафот этган бўлса ҳам ёзилади.')
  return { errors: errors, warnings: warnings }
}

export {
  zip as documentZip,
  buildDocx,
  fileName,
  validate,
  normalize,
  toCyrillic,
  currentJob,
  fmtDate,
  fmtSince,
  eduLines,
  workLine,
  workStartYear,
  workPeriod,
  relativeBirthPlace,
  relWorkLines,
  relBirthLines,
}
