// 由 tools/extract-tables.py 从 OneAsr sentence_boundary 的常量表抽取生成。
// 只放数据；判定逻辑在 textRules.ts。修改请同步 OneAsr 侧同名常量。

export const EN_FUNCTION_WORDS_LEFT: readonly string[] = [
  "a", "an", "the", "this", "these", "those", "my", "your", "his", "her", "its", "our",
  "their", "of", "to", "in", "on", "at", "for", "with", "by", "from", "can", "could", "will",
  "would", "shall", "should", "may", "might", "must", "do", "does", "did", "is", "are", "was",
  "were", "be", "been", "being", "am", "have", "has", "had", "not", "and", "but", "or", "nor",
  "so", "as", "than", "towards", "into", "onto", "above", "below", "under", "over", "through",
  "across", "along", "around", "against", "between", "during", "within", "without", "upon",
  "near", "behind", "beyond", "among", "inside", "outside", "beside", "off", "via", "per",
  "basically", "fundamentally", "actually", "literally", "essentially", "particularly",
  "especially", "simply", "merely", "probably", "possibly", "certainly", "generally",
];

export const CJK_FUNCTION_WORDS_LEFT: readonly string[] = [
  "和", "与", "及", "或", "在", "是", "把", "被", "将", "从", "对", "向", "往", "于", "给", "让", "使", "还",
  "也", "都", "就", "又", "而", "但", "会", "要", "能",
];

export const JA_DEMONSTRATIVES: readonly string[] = [
  "この", "その", "あの", "どの", "こんな", "そんな", "あんな", "こんなに", "そんなに", "あんなに",
];

export const CJK_PHRASE_CLOSE: readonly string[] = [
  "的", "了", "着", "过", "吗", "呢", "吧", "啊",
];

export const JA_PHRASE_CLOSE: readonly string[] = [
  "は", "が", "を", "に", "の", "と", "で", "も", "へ", "や", "より", "まで", "から", "ので", "のに", "なので", "けど",
  "けれど", "けれども", "ですので", "ですから",
];

export const KO_PHRASE_CLOSE: readonly string[] = [
  "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도", "로", "으로",
];

export const DISCOURSE_MARKERS: readonly string[] = [
  "okay", "ok", "now", "so", "well", "right", "alright", "look", "listen", "then", "hey", "oh",
  "uh", "um", "hmm", "basically", "fundamentally", "actually", "literally", "essentially",
];

export const TO_BINDING_LEFT: readonly string[] = [
  "need", "needs", "needed", "want", "wants", "wanted", "going", "have", "has", "had", "try",
  "tries", "trying", "tried", "able", "supposed", "expected", "likely", "unlikely", "required",
  "meant", "forced", "bound", "about", "prepared", "ready", "willing", "reluctant", "tend",
  "tends", "tended", "plan", "plans", "planned", "hope", "hopes", "hoped",
];

export const CJK_CONNECTOR_BIND_LEFT: readonly string[] = [
  "只", "正", "就", "是", "不", "并", "都", "也", "还", "又", "才", "却", "之", "并不是", "不是", "只是",
];

export const JA_NOMINALIZER_TAILS: readonly string[] = [
  "ので", "のに", "のだ", "のです", "のか", "のよ", "のね",
];

export const JA_LINE_START_PARTICLES: readonly string[] = [
  "は", "が", "を", "に", "の", "と", "で", "も", "へ", "や", "て", "って", "より", "まで", "から", "です", "ます",
  "だ", "た", "し", "な", "なあ", "よ", "ね", "さ", "わ", "か", "よね", "かな", "かい", "かしら", "ので", "のに",
  "なので", "けど", "けれど", "けれども", "ですので", "ですから",
];

export const KO_LINE_START_PARTICLES: readonly string[] = [
  "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도", "로", "으로",
];

export const ZH_LINE_START_PARTICLES: readonly string[] = [
  "的", "了", "着", "过", "吗", "呢", "吧",
];

export const JA_SURU_FORMS: readonly string[] = [
  "する", "した", "して", "します", "できる", "させる", "される", "しよう",
];

export const JA_HIRAGANA_NON_BIND: readonly string[] = [
  "はい", "ええ", "えっと", "じゃあ", "でも", "また", "あと", "まず", "みんな", "もっと", "こんにちは", "こんばんは",
];

export const JA_TURN_STARTERS: readonly string[] = [
  "はい", "じゃあ", "それでは", "では", "なるほど", "えっと", "ええ", "皆さん", "みなさん", "みんな", "こんにちは", "こんばんは",
  "まずは", "まず", "次に", "ところで", "ちなみに",
];

export const JA_ADDRESS_TOKENS: readonly string[] = [
  "皆さん", "みなさん", "みんな", "さん", "ちゃん", "くん", "こんにちは", "こんばんは", "おはよう",
];

export const JA_GREETING_TOKENS: readonly string[] = [
  "こんにちは", "こんばんは", "おはよう", "ございます", "よろしくお願いします",
];

export const ZH_CONNECTOR_STARTS: readonly string[] = [
  "但是", "因为", "所以", "而且", "或者", "如果", "虽然", "因此", "不过", "然后", "可是", "然而", "另外", "并且", "为了",
  "以及", "还有", "及其", "否则", "此外", "总之", "于是",
];

export const JA_COPULA_ENDINGS: readonly string[] = [
  "でした", "ました", "ませんでした", "ません", "です", "ます", "だった", "でしょう", "ましょう", "ください", "んです", "のです",
  "じゃありません",
];

export const JA_NOT_COPULA: readonly string[] = [
  "ただ", "まだ", "未だ",
];

export const JA_PREDICATE_STEMS: readonly string[] = [
  "する", "した", "して", "します", "できる", "ある", "いる", "なる", "やる", "いう", "思う", "見る", "行く", "来る",
];

export const JA_PREDICATE_SUFFIXES: readonly string[] = [
  "しました", "ました", "します", "ました", "して", "した", "ます", "です", "たい", "ない", "る", "た", "て", "う", "く",
  "ぐ", "す", "つ", "ぬ", "む", "ぶ", "い",
];

export const U35_SPACED_CONNECTORS: readonly string[] = [
  "y", "o", "pero", "porque", "cuando", "mientras", "entonces", "aunque", "donde", "sino",
  "et", "ou", "mais", "parce", "quand", "pendant", "donc", "alors", "und", "oder", "aber",
  "weil", "wenn", "während", "dass", "obwohl", "deshalb", "e", "mas", "quando", "enquanto",
  "então", "embora", "ma", "perché", "mentre", "allora", "però", "en", "maar", "omdat",
  "wanneer", "terwijl", "als", "och", "eller", "men", "för", "när", "om", "og", "fordi",
  "hvis", "ja", "tai", "mutta", "koska", "kun", "jos", "i", "lub", "ale", "ponieważ", "kiedy",
  "jeśli", "ve", "veya", "ama", "çünkü", "eğer", "sonra", "và", "hoặc", "nhưng", "vì", "khi",
  "nếu", "thì", "nên", "और", "या", "लेकिन", "क्योंकि", "जब", "यदि", "तो", "و", "أو", "لكن",
  "لأن", "عندما", "إذا", "ثم", "או", "אבל", "כי", "אם", "אז", "и", "или", "но", "потому",
  "когда", "если",
];

export const U35_SPACED_FUNCTION_WORDS: readonly string[] = [
  "und", "oder", "aber", "et", "ou", "mais", "y", "o", "pero", "e", "mas", "ma", "però", "en",
  "maar", "och", "eller", "men", "og", "ja", "tai", "mutta", "i", "lub", "ale", "ve", "veya",
  "ama", "và", "hoặc", "nhưng", "и", "или", "но", "el", "la", "los", "las", "un", "una",
  "unos", "unas", "de", "del", "al", "por", "para", "con", "sin", "su", "sus", "mi", "mis",
  "tu", "tus", "es", "son", "está", "están", "se", "lo", "le", "les", "une", "du", "des", "au",
  "aux", "à", "par", "pour", "avec", "sans", "sur", "son", "sa", "ses", "mon", "ma", "mes",
  "ton", "ta", "tes", "est", "sont", "ce", "cet", "cette", "ces", "je", "il", "elle", "nous",
  "vous", "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer",
  "eines", "von", "zu", "mit", "für", "auf", "aus", "bei", "nach", "über", "unter", "ist",
  "sind", "im", "am", "vom", "zum", "zur", "sich", "o", "os", "as", "um", "uma", "do", "da",
  "dos", "das", "em", "no", "na", "nos", "nas", "é", "são", "seu", "sua", "seus", "suas", "il",
  "gli", "uno", "della", "dello", "dei", "delle", "nel", "nella", "è", "sono", "si", "suo",
  "sua", "suoi", "sue", "het", "een", "van", "te", "voor", "op", "aan", "zijn", "của", "là",
  "các", "những", "một", "trong", "với", "để", "không", "được", "đã", "sẽ", "này", "đó", "का",
  "के", "की", "में", "से", "को", "है", "हैं", "था", "थे", "एक", "यह", "वह", "तो", "ही", "भी",
  "في", "من", "إلى", "على", "أن", "إن", "هذا", "هذه", "التي", "الذي", "هو", "هي", "של", "את",
  "על", "אל", "עם", "זה", "זו", "היא", "הוא", "bir", "bu", "şu", "ile", "için",
];

export const EN_CONNECTORS: readonly string[] = [
  "and", "but", "or", "so", "because", "when", "while", "which", "that", "if", "then",
  "though", "although", "however", "therefore", "before", "where", "who", "what", "whom",
  "whose", "as", "until", "once", "since", "unless", "whereas",
];

export const ZH_CONNECTORS: readonly string[] = [
  "但是", "因为", "所以", "而且", "或者", "如果", "虽然", "因此", "不过", "然后", "可是", "然而", "另外", "并且", "所以",
  "为了", "以及", "还有", "及其",
];

export const JA_CONNECTORS: readonly string[] = [
  "しかし", "だから", "そして", "でも", "また", "または", "ゆえに", "そのため", "さらに", "それで", "それから", "はい", "じゃあ",
  "それでは", "なるほど", "えっと", "ええ", "まずは", "まず", "次に", "ところで", "ちなみに", "実は", "もっと", "皆さん", "みなさん",
  "みんな", "こんにちは", "こんばんは",
];

export const KO_CONNECTORS: readonly string[] = [
  "하지만", "그래서", "왜냐하면", "그리고", "또는", "만약", "비록", "따라서", "그러나", "그러므로", "그런데", "및", "왜냐면",
];

export const FR_CONNECTORS: readonly string[] = [
  "donc", "mais", "et", "ou", "parce", "quand", "bien", "cependant", "néanmoins",
];

export const DE_CONNECTORS: readonly string[] = [
  "und", "oder", "aber", "weil", "wenn", "daher", "doch", "jedoch",
];

export const ES_CONNECTORS: readonly string[] = [
  "pero", "porque", "y", "o", "cuando", "aunque", "sin", "por", "además", "entonces",
];

export const PT_CONNECTORS: readonly string[] = [
  "mas", "porque", "e", "ou", "quando", "embora", "portanto", "então", "além",
];

export const IT_CONNECTORS: readonly string[] = [
  "quindi", "però", "ma", "perché", "e", "o", "quando", "anche", "dunque", "inoltre",
];

export const EN_ABBREVIATIONS: readonly string[] = [
];
