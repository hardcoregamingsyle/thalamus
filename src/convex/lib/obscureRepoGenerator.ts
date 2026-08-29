"use node";

import crypto from "crypto";

const ADJECTIVES = [
  "ancient", "autumn", "azure", "bamboo", "bent", "bitter", "blazing", "bouncy",
  "brave", "broken", "brown", "burning", "calm", "candid", "celestial", "chilly",
  "clever", "cold", "cosmic", "crimson", "crisp", "curly", "cute", "damp",
  "dapper", "dark", "daring", "dawn", "dizzy", "docile", "dormant", "drifting",
  "dry", "dusty", "eager", "early", "elastic", "electric", "elegant", "empty",
  "faint", "fair", "faithful", "falling", "fancy", "fatal", "fierce", "flaky",
  "flat", "floating", "fluffy", "flying", "foggy", "frosty", "frozen", "funky",
  "furry", "gentle", "ghostly", "giant", "glassy", "gliding", "golden", "graceful",
  "gravel", "gray", "greasy", "great", "green", "groovy", "grumpy", "hairy",
  "hanging", "happy", "harsh", "hazy", "hidden", "hollow", "holy", "honest",
  "horizontal", "hot", "humble", "icy", "ideal", "immense", "impish", "indigo",
  "inner", "jagged", "jazzy", "jolly", "juicy", "jumpy", "keen", "kind",
  "lacy", "large", "late", "lazy", "leaky", "lingering", "little", "lively",
  "lofty", "loud", "lovely", "lucky", "luminous", "lush", "mad", "magenta",
  "magic", "majestic", "massive", "meek", "mellow", "merry", "messy", "mighty",
  "milky", "misty", "mixed", "modern", "modest", "moist", "molten", "motionless",
  "muddy", "muffled", "mute", "mystic", "narrow", "nasty", "naughty", "neat",
  "nervous", "noble", "noisy", "oblique", "odd", "oily", "old", "olive",
  "orange", "orbital", "outer", "pale", "patient", "peaceful", "perfect", "plain",
  "plastic", "playful", "plump", "polite", "polka", "precious", "pretty", "prickly",
  "primal", "prime", "pristine", "prompt", "proper", "proud", "public", "puffy",
  "purple", "quaint", "quick", "quiet", "rainy", "rapid", "rare", "raw",
  "razor", "ready", "real", "red", "restless", "rich", "rigid", "ripe",
  "roaring", "robust", "rocky", "rough", "round", "royal", "ruby", "rude",
  "rural", "rustic", "rusty", "sacred", "sad", "salty", "sandy", "sassy",
  "scared", "scenic", "scented", "secret", "shallow", "shiny", "short", "shy",
  "silent", "silly", "silver", "simple", "sleepy", "slim", "slippery", "slow",
  "small", "smart", "smooth", "snug", "soft", "solar", "solid", "somber",
  "soothing", "sore", "sound", "sour", "sparkly", "sparse", "spicy", "spiral",
  "splendid", "spotted", "square", "stable", "stale", "steady", "steep", "stellar",
  "sticky", "still", "stocky", "stormy", "straight", "strange", "striped", "strong",
  "stubborn", "sturdy", "subtle", "sudden", "sugary", "sunny", "super", "surreal",
  "sweet", "swift", "tall", "tame", "tangled", "tart", "tender", "tense",
  "thick", "thin", "thirsty", "thorny", "thorough", "thunder", "tidy", "tight",
  "timely", "timid", "tiny", "tired", "tough", "tranquil", "trapped", "tricky",
  "tropical", "troubled", "true", "twin", "ugly", "unbiased", "uneven", "unique",
  "united", "unkempt", "upper", "upright", "urban", "useful", "vacant", "vague",
  "valid", "valued", "vapor", "vast", "velvet", "vibrant", "violet", "vocal",
  "wandering", "warm", "wary", "wavy", "waxy", "weak", "weary", "wee",
  "weighty", "wet", "whimsical", "whispered", "wide", "wild", "willing", "winding",
  "winter", "wiry", "wise", "wispy", "witty", "wooden", "woozy", "worldly",
  "wormy", "worried", "wrong", "young", "youthful", "zany", "zealous", "zenith",
];

const NOUNS = [
  "albatross", "alligator", "anchovy", "ant", "anteater", "antelope", "aphid",
  "armadillo", "badger", "barnacle", "barracuda", "bat", "bear", "beaver",
  "bedbug", "bee", "beetle", "bird", "bison", "blowfish", "bluebird", "boar",
  "bobcat", "bonobo", "bovid", "buffalo", "bug", "butterfly", "buzzard",
  "camel", "capybara", "cardinal", "caribou", "carp", "cat", "caterpillar",
  "catfish", "cattle", "cheetah", "chicken", "chimp", "chinchilla", "chipmunk",
  "cicada", "clam", "clownfish", "cobra", "cockroach", "cod", "condor",
  "coral", "cormorant", "coyote", "crab", "crane", "cricket", "crocodile",
  "crow", "cuckoo", "curlew", "deer", "dinosaur", "dog", "dolphin", "donkey",
  "dove", "dragonfly", "duck", "dugong", "dungbeetle", "eagle", "earthworm",
  "earwig", "eel", "egret", "elephant", "elk", "emu", "falcon", "ferret",
  "finch", "firefly", "fish", "flamingo", "flea", "fly", "flyingfish", "fossa",
  "fox", "frog", "gazelle", "gecko", "gerbil", "giraffe", "gnat", "gnu",
  "goat", "goldfish", "goose", "gopher", "gorilla", "grasshopper", "grouse",
  "gull", "haddock", "hamster", "hare", "hawk", "hedgehog", "heron", "herring",
  "hippo", "hornet", "horse", "hound", "hoverfly", "hummingbird", "hyena",
  "ibis", "iguana", "impala", "jackal", "jaguar", "jaguarundi", "jay", "jellyfish",
  "kangaroo", "kingfisher", "kite", "kiwi", "koala", "koi", "krill", "labrador",
  "ladybug", "lamprey", "landrail", "lark", "leech", "lemming", "lemur", "leopard",
  "limpet", "lion", "llama", "lobster", "locust", "loon", "louse", "lynx",
  "macaw", "mackerel", "magpie", "mallard", "mammoth", "manatee", "mandrill",
  "manta", "marmoset", "marmot", "meerkat", "milkfish", "mink", "minnow", "mite",
  "mockingbird", "mole", "mongoose", "monkey", "moose", "mosquito", "moth",
  "mouse", "mule", "muskox", "muskrat", "myna", "newt", "nightingale", "numbat",
  "ocelot", "octopus", "okapi", "olive", "opossum", "orangutan", "orca", "oriole",
  "osprey", "ostrich", "otter", "owl", "ox", "oyster", "panda", "panther",
  "parakeet", "parrot", "parrotfish", "partridge", "peacock", "pelican", "penguin",
  "perch", "pheasant", "pig", "pigeon", "pike", "piranha", "platypus", "pollock",
  "pony", "porcupine", "porpoise", "possum", "prawn", "pronghorn", "puffin",
  "puma", "python", "quail", "queenfish", "quetzal", "rabbit", "raccoon", "ram",
  "rat", "raven", "ray", "razorbill", "reindeer", "rhino", "robin", "rooster",
  "rottweiler", "sailfish", "salamander", "salmon", "sandpiper", "sardine",
  "sawfish", "scallop", "scorpion", "seahorse", "seal", "seastar", "serval",
  "shark", "sheep", "shrew", "shrimp", "silkworm", "skate", "skink", "skua",
  "skunk", "sloth", "slug", "snail", "snake", "sole", "sparrow", "spider",
  "sponge", "spoonbill", "squid", "squirrel", "starfish", "stingray", "stoat",
  "stork", "sturgeon", "sunfish", "swallow", "swan", "swift", "swordfish",
  "tadpole", "tang", "tapir", "tarantula", "tarsier", "termite", "tern", "thrush",
  "tick", "tiger", "toad", "tomcat", "toucan", "trout", "tuna", "turkey",
  "turtle", "turtlehead", "uakari", "urial", "vampirebat", "vicuna", "viper",
  "vole", "vulture", "wallaby", "walrus", "wasp", "waxwing", "weasel", "weevil",
  "whale", "whippet", "whitefish", "wildcat", "wildebeest", "wolf", "wolverine",
  "wombat", "woodcock", "woodpecker", "worm", "wren", "yak", "zebra", "zebu",
  "zenaida", "zopilote",
];

function pick<T>(list: T[]): T {
  const bytes = crypto.randomBytes(4);
  const idx = bytes.readUInt32BE(0) >>> 0; // force unsigned
  return list[idx % list.length];
}

export function randomDigits(len: number): string {
  const bytes = crypto.randomBytes(len);
  let s = "";
  for (const b of bytes) {
    s += String.fromCharCode(0x30 + (b % 10)); // 0-9
  }
  return s;
}

export function generateObscureRepoName(): string {
  const adj = pick(ADJECTIVES);
  const noun = pick(NOUNS);
  const num = randomDigits(8);
  return `${adj}-${noun}-${num}`;
}

// Readable, human-recognisable repo name: three random English words then six
// random digits, e.g. "ancient-autumn-azure-482913". Used for repos created on
// the user's own GitHub account, where the name is what the user sees on their
// profile.
export function generateReadableRepoName(): string {
  const words = [pick(ADJECTIVES), pick(ADJECTIVES), pick(ADJECTIVES)];
  const num = randomDigits(6);
  return `${words.join("-")}-${num}`;
}

export function generateObscureBranchName(): string {
  const adj = pick(ADJECTIVES);
  const noun = pick(NOUNS);
  const num = randomDigits(6);
  return `dev/${adj}-${noun}-${num}`;
}
