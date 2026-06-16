"""app/naming.py — word.word.word slug generation."""

import random
from app.db import db_connection

WORDS = [
    "amber","anvil","arrow","atlas","azure","bacon","badge","banjo","baron",
    "basil","batch","bayou","beach","bells","birch","bison","black","blade",
    "blaze","blend","bloom","blown","blues","blunt","blaze","board","bonds",
    "bonus","boost","boron","botch","bound","brace","braid","brake","brand",
    "brave","brawn","bread","brick","bride","brief","brine","brink","brisk",
    "broil","bronze","brook","broth","brown","brush","brute","budge","built",
    "bulge","bulk","burns","burst","cable","cadet","cairn","camel","canal",
    "candy","cargo","cedar","chain","chalk","champ","chaos","charm","chase",
    "chess","chief","chimp","chips","chord","chunk","cinch","civic","civil",
    "claim","clamp","clang","clash","clasp","class","clean","clear","climb",
    "clink","cloak","clock","clone","cloud","clout","clown","coast","cobra",
    "comet","coral","crane","crank","crash","creak","creek","crisp","cross",
    "crown","cruel","crush","crust","cycle","daisy","delta","depot","derby",
    "disco","diver","dogma","domed","draft","drain","drake","dream","drift",
    "drill","drone","drove","dunes","dusk","dwarf","eagle","earth","ebony",
    "eight","elbow","ember","epoch","equal","error","event","exile","extra",
    "fable","facet","faint","faith","falls","fancy","fatal","fault","feast",
    "fence","ferry","fever","fiber","field","fiend","fifth","fifty","final",
    "fjord","flame","flank","flash","flask","fleet","flesh","flick","flint",
    "float","flood","floor","flour","fluid","fluke","flute","focal","force",
    "forge","forte","forum","found","frame","frank","fraud","freak","freed",
    "front","frost","fruit","funds","fused","gavel","ghost","glade","gland",
    "glare","glass","gleam","glide","glint","globe","gloom","glory","gloss",
    "glyph","gnome","grace","grade","graft","grain","grand","grant","grasp",
    "grass","grate","grave","graze","greed","greet","grief","grind","groan",
    "grope","group","grout","grove","growl","gruel","grunt","guard","guest",
    "guide","guild","guile","guilt","guise","gusto","haste","haven","heron",
    "hinge","hoary","holly","homer","honor","horse","hotel","hound","house",
    "human","humor","hurry","hydra","ideal","image","inbox","indie","inert",
    "input","inter","intra","ivory","japan","jelly","jewel","joust","judge",
    "jumbo","junto","karma","kayak","kelp","knack","knave","knife","knight",
    "knock","known","label","lance","laser","latch","later","lathe","layer",
    "leach","leapt","ledge","legal","lemon","level","lever","light","linen",
    "liner","liver","llama","lodge","lofty","logic","lotus","lover","lower",
    "lunar","lusty","lyric","magic","maize","manor","maple","march","marsh",
    "mason","match","mauve","maxim","mayor","medal","mercy","merit","metal",
    "micro","might","minor","mirage","mirth","model","moose","morale","mossy",
    "motto","mount","mouse","mouth","mulch","mural","music","myrrh","naval",
    "nerve","nexus","night","noble","north","notch","novel","nymph","oaken",
    "oasis","obsid","ocean","offer","olive","onyx","optic","orbit","order",
    "other","outer","oxide","ozone","paint","panel","paper","patch","pause",
    "pearl","pedal","penny","perch","peril","perky","petty","phase","phial",
    "piano","pilot","pinch","pixel","pixel","place","plain","plane","plank",
    "plant","plate","plaza","plume","plunk","plush","point","polar","poll",
    "posse","power","press","price","pride","prime","prism","probe","prose",
    "proud","prune","psalm","pulse","punch","pupil","quest","queue","quick",
    "quiet","quota","quote","radar","radix","radon","range","rapid","ratio",
    "raven","realm","rebel","relay","relic","remix","resin","retro","ridge",
    "rivet","robin","rocky","rodeo","rogue","roman","roost","rouge","rough",
    "round","route","royal","rugby","ruler","rupee","rusty","saint","salon",
    "sandy","sauce","scale","scamp","scant","scarp","scathe","scene","scope",
    "scout","scrap","scrawl","screw","scrub","serum","seven","shade","shaft",
    "shale","shank","shark","sharp","sheen","sheer","shelf","shell","shift",
    "shire","shoal","shore","short","shout","shove","sigma","sixth","sixty",
    "skate","skill","skimp","skull","slate","slave","sleek","sleet","slide",
    "slime","slope","sloth","small","smart","smash","smear","smell","smelt",
    "smirk","smoke","smolt","snail","snake","snare","sneak","snipe","solar",
    "solid","sonic","sonar","south","space","spark","spawn","speak","spear",
    "speck","speed","spell","spire","spite","spoke","spore","sport","spout",
    "spray","sprig","squad","squat","squid","stack","staff","stage","stain",
    "stair","stake","stale","stalk","stand","stark","start","state","stays",
    "steam","steel","steep","steer","stern","stone","storm","stomp","stout",
    "strap","straw","stray","strip","strut","study","stump","style","sugar",
    "suite","surge","swamp","swarm","swear","swede","sweep","swept","swift",
    "swirl","sword","swore","synth","talon","tango","taunt","tawny","thorn",
    "tiger","timed","titan","token","tonic","torch","total","totem","touch",
    "tough","trace","track","trail","train","trait","tramp","trawl","tread",
    "trice","trick","tried","troop","trove","truce","truck","trump","trunk",
    "truss","trust","truth","tuned","tunic","turbo","twist","ultra","umbra",
    "uncut","unify","unity","until","upper","upset","utter","valor","valve",
    "vapid","vault","vigor","viral","vista","vital","vivid","vocal","voice",
    "voila","voter","vortex","waltz","watch","water","weald","wedge","weird",
    "whale","wheat","wheel","where","which","while","white","whole","whose",
    "wider","witch","witty","world","wrath","write","wrote","yacht","yield",
    "young","youth","zonal","zones",
]


def generate_slug(max_attempts: int = 20) -> str:
    """Return a unique word.word.word slug."""
    with db_connection() as conn:
        for _ in range(max_attempts):
            slug = ".".join(random.choices(WORDS, k=3))
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM prediction_sessions WHERE slug = %s", (slug,)
                )
                if not cur.fetchone():
                    return slug
    raise RuntimeError("Could not generate a unique slug after many attempts")
