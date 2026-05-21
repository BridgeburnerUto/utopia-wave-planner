#!/usr/bin/env python3
"""
Pushes manually-extracted screenshot data to Firebase.
Data was read directly from webp screenshots — no API key needed.

Run:  python push_extracted.py
"""

import os
import time
import warnings
import requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
warnings.filterwarnings('ignore')

# ── Firebase config ────────────────────────────────────────────────────────────
FB_PROJECT = 'utopia-leaderboard'
FB_API_KEY = 'AIzaSyAnlkMabj-9a-fUEx66o86w2CnJaUgboIY'
FB_BASE    = f'https://firestore.googleapis.com/v1/projects/{FB_PROJECT}/databases/(default)/documents'

# ── Firestore helpers ──────────────────────────────────────────────────────────

def to_fb(v):
    if v is None:            return {'nullValue': None}
    if isinstance(v, bool):  return {'booleanValue': v}
    if isinstance(v, int):   return {'integerValue': str(v)}
    if isinstance(v, float): return {'doubleValue': v}
    if isinstance(v, str):   return {'stringValue': v}
    if isinstance(v, list):  return {'arrayValue': {'values': [to_fb(i) for i in v]}}
    if isinstance(v, dict):  return {'mapValue': {'fields': {k: to_fb(val) for k, val in v.items()}}}
    return {'stringValue': str(v)}

def from_fb(v):
    if not v: return None
    if 'stringValue'  in v: return v['stringValue']
    if 'integerValue' in v: return int(v['integerValue'])
    if 'doubleValue'  in v: return v['doubleValue']
    if 'booleanValue' in v: return v['booleanValue']
    if 'nullValue'    in v: return None
    if 'arrayValue'   in v: return [from_fb(i) for i in v['arrayValue'].get('values', [])]
    if 'mapValue'     in v: return {k: from_fb(val) for k, val in v['mapValue'].get('fields', {}).items()}
    return None

def fb_write(path, data):
    fields = {k: to_fb(v) for k, v in data.items()}
    r = requests.patch(f'{FB_BASE}/{path}?key={FB_API_KEY}', json={'fields': fields}, timeout=10, verify=False)
    r.raise_for_status()

def fb_query(collection):
    url  = f'{FB_BASE}:runQuery?key={FB_API_KEY}'
    body = {'structuredQuery': {'from': [{'collectionId': collection}], 'limit': 2000}}
    r    = requests.post(url, json=body, timeout=10, verify=False)
    r.raise_for_status()
    docs = []
    for entry in r.json():
        if 'document' not in entry:
            continue
        doc = entry['document']
        fields = {k: from_fb(v) for k, v in doc['fields'].items()}
        # Preserve the Firestore document name (last path segment = doc ID)
        fields['_docId'] = doc['name'].split('/')[-1]
        docs.append(fields)
    return docs

def new_id():
    return f"{int(time.time() * 1000):x}{os.urandom(2).hex()}"

# ── Extracted data ─────────────────────────────────────────────────────────────
# Each entry: identity label, age, location, kdName (display name), provinces list
# Province: slot, name, ruler  (race/personality not captured for all screenshots)

SNAPSHOTS = [
    {
        'identity': 'Evil habits',
        'age': 'a113',
        'location': '5:11',
        'kdName': '',
        'provinces': [
            {'slot':  1, 'name': 'evil farter',              'ruler': 'borat'},
            {'slot':  2, 'name': 'Evil Queen Elizabeth',     'ruler': 'Yukkie'},
            {'slot':  3, 'name': 'Evil Shekel Hoarder',      'ruler': 'Golden Co'},
            {'slot':  4, 'name': 'Evil Death Corps',         'ruler': 'Freya'},
            {'slot':  5, 'name': 'Evil Shaft',               'ruler': 'Arn'},
            {'slot':  6, 'name': 'Blue Evil Eye',            'ruler': 'Frank'},
            {'slot':  7, 'name': 'EVIL WASNNOTME',           'ruler': 'SIR WASN'},
            {'slot':  8, 'name': 'Evil Bad Decision',        'ruler': 'Evil Me Ag'},
            {'slot':  9, 'name': 'Evil CrackHead',           'ruler': 'Gotanymo'},
            {'slot': 10, 'name': 'Evil Idolater',            'ruler': 'Be your Idol'},
            {'slot': 11, 'name': 'Evil Nose Picker',         'ruler': 'Gaar'},
            {'slot': 12, 'name': 'Evil corgi',               'ruler': 'Corgi'},
            {'slot': 13, 'name': 'Evil king',                'ruler': 'Solomon'},
            {'slot': 14, 'name': 'Evil Anger',               'ruler': 'Vile'},
            {'slot': 15, 'name': 'As Evil As It Gets',       'ruler': 'Billy Hill'},
            {'slot': 16, 'name': 'Whisper Something Evil',   'ruler': 'Lay the Dr'},
            {'slot': 17, 'name': 'Evil Klepto',              'ruler': 'Kleptoma'},
            {'slot': 18, 'name': 'Evil John',                'ruler': 'John'},
            {'slot': 19, 'name': 'Evil Me',                  'ruler': 'bei'},
            {'slot': 20, 'name': 'Evil Princess',            'ruler': 'Kayla'},
            {'slot': 21, 'name': 'Evil livE',                'ruler': 'Livera'},
            {'slot': 22, 'name': 'Evil Smasher',             'ruler': 'Mr Doggy'},
        ],
    },
    {
        'identity': 'Not decided yet',
        'age': 'a113',
        'location': '2:12',
        'kdName': '',
        'provinces': [
            {'slot':  1, 'name': 'DOA',                         'ruler': 'MIA'},
            {'slot':  2, 'name': 'father',                      'ruler': 'Sectr'},
            {'slot':  3, 'name': 'Wilmington',                  'ruler': 'Roger'},
            {'slot':  4, 'name': 'Charlie Foxtrot',             'ruler': 'Ben'},
            {'slot':  5, 'name': 'Aldergarde',                  'ruler': 'Echo'},
            {'slot':  6, 'name': 'lame',                        'ruler': 'leo'},
            {'slot':  7, 'name': 'Dreamers',                    'ruler': 'Dream'},
            {'slot':  8, 'name': 'solido',                      'ruler': 'solido'},
            {'slot':  9, 'name': 'Beige',                       'ruler': 'Rip'},
            {'slot': 11, 'name': 'Hoeslayer',                   'ruler': 'Slayer'},
            {'slot': 14, 'name': 'Locust Star',                 'ruler': 'Neurosis'},
            {'slot': 16, 'name': 'Velveladeer',                 'ruler': 'Stank'},
            {'slot': 17, 'name': 'Weazol',                      'ruler': 'Wessel'},
            {'slot': 18, 'name': 'Deadliest Catch',             'ruler': 'Bill Petrie'},
            {'slot': 19, 'name': 'Monkey Magic',                'ruler': 'Monkey M'},
            {'slot': 20, 'name': 'Wretched Son of The Devil',   'ruler': 'Ratel'},
            {'slot': 21, 'name': 'Fowl Hollow',                 'ruler': 'Netami Se'},
            {'slot': 22, 'name': 'Pickled sassy donkey',        'ruler': 'Snake In D'},
            {'slot': 23, 'name': 'Open Your',                   'ruler': 'Purple'},
        ],
    },
    {
        'identity': 'Pinoy Vengeance',
        'age': 'a113',
        'location': '3:6',
        'kdName': '',
        'provinces': [
            {'slot':  1, 'name': 'Hurricane opal 1995',         'ruler': 'azazel'},
            {'slot':  2, 'name': 'Fengshen',                    'ruler': 'Chet'},
            {'slot':  3, 'name': 'DELUBYO',                     'ruler': 'Betong'},
            {'slot':  4, 'name': 'wishsilog',                   'ruler': 'Taytay mo'},
            {'slot':  5, 'name': 'Angela 1867',                 'ruler': 'Bee'},
            {'slot':  6, 'name': 'Haiyan',                      'ruler': 'MorQ'},
            {'slot':  7, 'name': 'Lawin',                       'ruler': 'Marks'},
            {'slot':  8, 'name': 'KaLmaEgi',                    'ruler': 'wawa'},
            {'slot':  9, 'name': 'Ketsana',                     'ruler': 'don'},
            {'slot': 10, 'name': 'Maria',                       'ruler': 'Baby hit y'},
            {'slot': 12, 'name': 'Sendong',                     'ruler': 'Washi'},
            {'slot': 13, 'name': 'Kristine',                    'ruler': 'Sapphire'},
            {'slot': 14, 'name': 'i wish for 4 more wishes',    'ruler': 'fil'},
            {'slot': 15, 'name': 'MUIFA',                       'ruler': 'Sarah'},
            {'slot': 16, 'name': 'Katrina',                     'ruler': 'Fun'},
            {'slot': 17, 'name': 'Gilda 1959',                  'ruler': 'Al Capone'},
            {'slot': 18, 'name': 'Bhola 1970',                  'ruler': 'Yahya Khan'},
            {'slot': 20, 'name': 'Rai',                         'ruler': 'lar'},
            {'slot': 21, 'name': 'Rosing',                      'ruler': 'Kukurikapoo'},
            {'slot': 22, 'name': 'Nickoys',                     'ruler': 'nico'},
        ],
    },
    {
        'identity': 'The core',
        'age': 'a113',
        'location': '4:2',
        'kdName': '',
        'provinces': [
            {'slot':  1, 'name': 'Lagunitas',                   'ruler': 'MaL'},
            {'slot':  2, 'name': 'Elfes Pilsen',                'ruler': 'James Be'},
            {'slot':  3, 'name': 'Karbach Brewing Co',          'ruler': 'Beer'},
            {'slot':  4, 'name': 'Tactical Nuclear Penguin',    'ruler': 'Boozer'},
            {'slot':  5, 'name': 'SamualAdamsLager',            'ruler': 'Bakerman'},
            {'slot':  6, 'name': 'KCBC Witbier',                'ruler': 'Biermiester'},
            {'slot':  7, 'name': 'Fountain of Ale',             'ruler': 'Big Mugs'},
            {'slot':  8, 'name': 'Bootleg brewing company',     'ruler': 'Falco'},
            {'slot':  9, 'name': 'Pils-Nerfed',                 'ruler': 'Witaba'},
            {'slot': 10, 'name': 'Fuzzy Logic',                 'ruler': 'Drunk'},
            {'slot': 11, 'name': 'Red Horse',                   'ruler': 'Player'},
            {'slot': 12, 'name': 'One great city brewing',      'ruler': 'Lmnop'},
            {'slot': 13, 'name': 'The Broken Seal',             'ruler': 'Cork'},
            {'slot': 14, 'name': 'Barrel Aged Chaotic Stout',   'ruler': 'Cheers'},
            {'slot': 15, 'name': 'Elfin Pale Ale',              'ruler': 'Wilfred'},
            {'slot': 16, 'name': 'Dancing Gnome',               'ruler': 'MaoQi'},
            {'slot': 17, 'name': 'Desert Deyja Cold Brewery',   'ruler': 'Sai'},
            {'slot': 18, 'name': 'Power-Up Pilsner',            'ruler': 'Yum Yum'},
            {'slot': 19, 'name': 'Destroying Angel',            'ruler': 'Mycellium'},
            {'slot': 20, 'name': 'Ale is Well',                 'ruler': 'Happy Be'},
            {'slot': 21, 'name': 'Oxynorm',                     'ruler': 'Oxy'},
            {'slot': 22, 'name': 'Granville Island lager',      'ruler': 'Sam'},
        ],
    },
    {
        'identity': 'The retirement home',
        'age': 'a113',
        'location': '3:3',
        'kdName': '',
        'provinces': [
            {'slot':  1, 'name': 'What Elf can I do',           'ruler': 'Freco'},
            {'slot':  2, 'name': 'Fields of Farmland',          'ruler': 'Jz Fields'},
            {'slot':  3, 'name': 'Clyde',                       'ruler': 'Milo'},
            {'slot':  4, 'name': 'White Rose',                  'ruler': 'NighT'},
            {'slot':  5, 'name': 'Ken',                         'ruler': 'TADAH'},
            {'slot':  6, 'name': 'Hexe',                        'ruler': 'Hexe'},
            {'slot':  7, 'name': 'Shadowland',                  'ruler': 'Suwon'},
            {'slot':  8, 'name': 'SilentBlizz',                 'ruler': 'Voide'},
            {'slot':  9, 'name': 'Mithril Cemetery',            'ruler': 'Nagash'},
            {'slot': 10, 'name': 'Four Wonders',                'ruler': 'Sunam'},
            {'slot': 11, 'name': 'Gramps',                      'ruler': 'Taldor'},
            {'slot': 12, 'name': 'Ereshkigal',                  'ruler': 'Aurora'},
            {'slot': 13, 'name': 'Krinn',                       'ruler': 'Krinneh'},
            {'slot': 14, 'name': 'Ragnark',                     'ruler': 'Hagar'},
            {'slot': 15, 'name': 'Muumimaa',                    'ruler': 'Mihkel'},
            {'slot': 16, 'name': 'Interstellar overdrive',      'ruler': 'Pinky'},
            {'slot': 18, 'name': 'Dragonsblood',                'ruler': 'Rabbit'},
            {'slot': 19, 'name': 'Ducks',                       'ruler': 'Ducks'},
            {'slot': 20, 'name': 'Fejjsan',                     'ruler': 'Fejjsan'},
            {'slot': 21, 'name': 'Desipised Icon',              'ruler': 'Despised'},
            {'slot': 23, 'name': 'FreezyLand',                  'ruler': 'Cryinfree'},
            {'slot': 24, 'name': 'Momentum',                    'ruler': 'Rodeo'},
        ],
    },
    # ── a114 ──────────────────────────────────────────────────────────────────
    {
        'identity': 'On Utopian Time',
        'age': 'a114',
        'location': '5:1',
        'kdName': 'On Utopian Time',
        'provinces': [
            {'slot':  1, 'name': 'Time to Shine',               'ruler': 'Naranga'},
            {'slot':  2, 'name': 'your time is up Give in',     'ruler': 'Iroc'},
            {'slot':  3, 'name': 'RazorcawTime',                'ruler': 'Jarack'},
            {'slot':  4, 'name': 'Waste of Time',               'ruler': 'Kushinade'},
            {'slot':  5, 'name': 'Time to play',                'ruler': 'Ash'},
            {'slot':  6, 'name': 'Slack Time',                  'ruler': 'Sephi'},
            {'slot':  7, 'name': 'Slow Attack times',           'ruler': 'Ed The Gr'},
            {'slot':  8, 'name': 'No Better Time',              'ruler': 'Emphiettes'},
            {'slot':  9, 'name': 'Fun times',                   'ruler': 'Benni'},
            {'slot': 10, 'name': 'Timeless Rock Band',          'ruler': 'Frankie'},
            {'slot': 11, 'name': 'Stewies Time Machine',        'ruler': 'Wheaties'},
            {'slot': 12, 'name': 'Misstress Of Time',           'ruler': 'Nitebloom'},
            {'slot': 13, 'name': 'Time',                        'ruler': 'Harry Ti'},
            {'slot': 14, 'name': 'About time dude',             'ruler': 'Timeman'},
            {'slot': 15, 'name': 'Father time',                 'ruler': 'Doggystyle'},
            {'slot': 16, 'name': 'Ill be there in a tick',      'ruler': 'BobbyPho'},
            {'slot': 17, 'name': 'Pee Time',                    'ruler': 'The Conni'},
            {'slot': 18, 'name': 'Sushi Sampo Time',            'ruler': 'Uruk-chai'},
            {'slot': 19, 'name': 'Its 5 OClock Somewhere',      'ruler': 'bane'},
            {'slot': 20, 'name': 'ticking time',                'ruler': 'Samantha'},
            {'slot': 21, 'name': 'Age of time',                 'ruler': 'triggerman'},
            {'slot': 22, 'name': 'Time Manipulator',            'ruler': 'Charlene'},
            {'slot': 23, 'name': '',                            'ruler': 'Patrick'},
        ],
    },
    {
        'identity': 'Nature of war',
        'age': 'a114',
        'location': '5:5',
        'kdName': 'busy dnd pls',
        'provinces': [
            {'slot':  1, 'name': 'Stomp the grass',             'ruler': 'Mr Green'},
            {'slot':  2, 'name': 'To Scare The Snake',          'ruler': 'RamboBLaw'},
            {'slot':  3, 'name': 'Borrow a corpse',             'ruler': 'Borrow'},
            {'slot':  4, 'name': 'To resurrect the soul',       'ruler': 'Kate'},
            {'slot':  5, 'name': 'Lure the tiger',              'ruler': 'Uncle Monty'},
            {'slot':  6, 'name': 'down the mountain',           'ruler': 'Tso'},
            {'slot':  7, 'name': 'In order to capture',         'ruler': 'Necrome'},
            {'slot':  8, 'name': 'one must let loose',          'ruler': 'ZaEl'},
            {'slot':  9, 'name': 'Tossing out a brick',         'ruler': 'Solid as a Rock'},
            {'slot': 10, 'name': 'to lure a jade gem',          'ruler': 'Arthur'},
            {'slot': 11, 'name': 'Deafeat the enemy',           'ruler': 'BuckShaQ'},
            {'slot': 12, 'name': 'capturing their chief',       'ruler': 'Joro'},
            {'slot': 13, 'name': 'Remove the firewood',         'ruler': 'Mr P'},
            {'slot': 14, 'name': 'from under the pot',          'ruler': 'hanuman'},
            {'slot': 15, 'name': 'Disturb the water',           'ruler': 'Poseidon'},
            {'slot': 16, 'name': 'and catch a fish',            'ruler': 'Hua Rong'},
            {'slot': 17, 'name': 'Slough off the',              'ruler': 'SunTzu'},
            {'slot': 18, 'name': 'Cicadas golden shell',        'ruler': 'irbis'},
            {'slot': 19, 'name': 'Shut the door to',            'ruler': 'Qin Shi Huang'},
            {'slot': 20, 'name': 'catch the thief',             'ruler': 'Shfitty-Five'},
            {'slot': 21, 'name': 'Replace the Beams',           'ruler': 'Gerard'},
            {'slot': 22, 'name': 'with rotten timbers',         'ruler': 'Stout'},
            {'slot': 23, 'name': 'Feign madness but',           'ruler': 'Lange'},
            {'slot': 24, 'name': 'keep your balance',           'ruler': 'iviwe'},
            {'slot': 25, 'name': 'The art of war',              'ruler': 'Nathanos Bligh'},
        ],
    },
    {
        'identity': 'Pinoy Vengeance',
        'age': 'a114',
        'location': '5:6',
        'kdName': 'Defense of the Ancients',
        'provinces': [
            {'slot':  1, 'name': 'Enchantress',                     'ruler': 'Healer'},
            {'slot':  2, 'name': 'Rhasta its Tricksy',              'ruler': 'Pulse'},
            {'slot':  4, 'name': 'Squee Spleen and Spoon',          'ruler': 'Rumpelstilskin'},
            {'slot':  5, 'name': 'Alleria the Windrunner',          'ruler': 'Alleria'},
            {'slot':  6, 'name': 'Keeper of the Light',             'ruler': 'Ezalor'},
            {'slot':  7, 'name': 'Buriza do kyanon',                'ruler': 'Fuzzy wuzzy'},
            {'slot':  8, 'name': 'Naix the Lifestealer',            'ruler': 'Don'},
            {'slot':  9, 'name': 'Moose',                           'ruler': 'Keno'},
            {'slot': 10, 'name': 'Omniknight',                      'ruler': 'Purist Thunderwrath'},
            {'slot': 11, 'name': 'Skeleton King',                   'ruler': 'Marks'},
            {'slot': 12, 'name': 'Oracle',                          'ruler': 'byebaby'},
            {'slot': 13, 'name': 'Tusk',                            'ruler': 'Fun'},
            {'slot': 14, 'name': 'L I C H',                         'ruler': 'Ethreain'},
            {'slot': 15, 'name': 'POTM Mirana Nightshade',          'ruler': 'Reinor'},
            {'slot': 16, 'name': 'SVENN',                           'ruler': 'BETONG'},
            {'slot': 17, 'name': 'Nyx',                             'ruler': 'Maesher'},
            {'slot': 18, 'name': 'Luna moonfang the moon rider',    'ruler': 'wawa'},
            {'slot': 19, 'name': 'Strygwyr',                        'ruler': 'Kukurikapoo'},
            {'slot': 20, 'name': 'Zues Lord of Olympia',            'ruler': 'Zues'},
            {'slot': 21, 'name': 'Lina Inverse',                    'ruler': 'Sapphire'},
            {'slot': 22, 'name': 'BloodSeeker',                     'ruler': 'nico'},
            {'slot': 23, 'name': 'Invoker',                         'ruler': 'MorQ'},
            {'slot': 24, 'name': 'ViPeR',                           'ruler': 'Yancie'},
        ],
    },
    {
        'identity': 'The core',
        'age': 'a114',
        'location': '4:5',
        'kdName': 'One Piece',
        'provinces': [
            {'slot':  1, 'name': 'Sactown Sanji',               'ruler': 'Red Reddington'},
            {'slot':  2, 'name': 'Eneru',                       'ruler': 'Player'},
            {'slot':  3, 'name': 'Tom',                         'ruler': 'Wilf'},
            {'slot':  4, 'name': 'Choppa',                      'ruler': 'Big Balls'},
            {'slot':  5, 'name': 'Smoker',                      'ruler': 'MaoQi'},
            {'slot':  6, 'name': 'Imu',                         'ruler': 'Imu'},
            {'slot':  7, 'name': 'WhiteBeard',                  'ruler': 'Bakerman'},
            {'slot':  8, 'name': 'Sanjuan Wolf',                'ruler': 'Shanks'},
            {'slot':  9, 'name': 'Duke Dogstorm',               'ruler': 'Colossal Battleship'},
            {'slot': 10, 'name': 'Fujitora',                    'ruler': 'Witaba'},
            {'slot': 11, 'name': 'Kuzan',                       'ruler': 'Issho'},
            {'slot': 12, 'name': 'Monkey D Luffy',              'ruler': 'Falco'},
            {'slot': 13, 'name': 'Nico Robin',                  'ruler': 'Luffy'},
            {'slot': 14, 'name': 'Shimotsuki Village',          'ruler': 'MaL'},
            {'slot': 15, 'name': 'Brook',                       'ruler': 'Sai'},
            {'slot': 16, 'name': 'Franky',                      'ruler': 'Steve'},
            {'slot': 17, 'name': 'Caesar Clown',                'ruler': 'Machine man'},
            {'slot': 18, 'name': 'Vegapunk Atlas',              'ruler': 'Devious'},
            {'slot': 19, 'name': 'Vasco Shot',                  'ruler': 'Angel'},
            {'slot': 20, 'name': 'Jinbe',                       'ruler': 'Cork'},
            {'slot': 21, 'name': 'Zoro',                        'ruler': 'Jinbe'},
            {'slot': 22, 'name': 'Gold Roger 2',                'ruler': 'Jtm'},
            {'slot': 23, 'name': 'Dracule Mihawk',              'ruler': 'Sam'},
            {'slot': 24, 'name': '',                            'ruler': 'Edward'},
        ],
    },
    # ── a115 ──────────────────────────────────────────────────────────────────
    {
        'identity': '5:1 from a115',
        'age': 'a115',
        'location': '5:1',
        'kdName': '',
        'provinces': [
            {'slot':  1, 'name': 'Arthas Death Coil Shots',     'ruler': 'HeXXeS'},
            {'slot':  2, 'name': 'Dam Castles',                  'ruler': 'Scotland'},
            {'slot':  3, 'name': 'The Horde Guinness',           'ruler': 'Ignore me'},
            {'slot':  4, 'name': 'Uther the Stoutbringer',       'ruler': 'Jon'},
            {'slot':  5, 'name': 'Hellstorm',                    'ruler': 'Daimon Hellstrom'},
            {'slot':  6, 'name': 'Brightwing the Faerie Dragon', 'ruler': 'Brightwing'},
            {'slot':  7, 'name': 'Dark Warden',                  'ruler': 'getRISHI'},
            {'slot':  8, 'name': 'Brewer Zhen',                  'ruler': 'panda'},
            {'slot':  9, 'name': 'All I see is darkness',        'ruler': 'Shazalot'},
            {'slot': 10, 'name': 'Azeroth',                      'ruler': 'Jack slayer'},
            {'slot': 11, 'name': 'Goldshire Golden Ale',         'ruler': 'Cpop'},
            {'slot': 12, 'name': 'Primus Wine',                  'ruler': 'Twily'},
            {'slot': 13, 'name': 'Cenarius',                     'ruler': 'NORTH'},
            {'slot': 14, 'name': 'Hogger Mead',                  'ruler': 'Hogger'},
            {'slot': 15, 'name': 'Bolvar Fordragon',             'ruler': 'cage'},
            {'slot': 16, 'name': 'Shadowland',                   'ruler': 'Klas'},
            {'slot': 17, 'name': 'Orcish orc of the orcs',       'ruler': 'Escanor'},
            {'slot': 18, 'name': 'Chen Stormstout',              'ruler': 'Psych'},
            {'slot': 19, 'name': 'Undercity',                    'ruler': 'Xaric'},
            {'slot': 20, 'name': 'Murloc Absinthe',              'ruler': 'Baldy'},
            {'slot': 21, 'name': 'Zak zak',                      'ruler': 'Babert'},
            {'slot': 22, 'name': 'Grimbooze Thunderbrew',        'ruler': 'Avenger'},
            {'slot': 23, 'name': 'Lorthemar',                    'ruler': 'Czen'},
        ],
    },
    {
        'identity': 'The core',
        'age': 'a115',
        'location': '5:8',
        'kdName': '',
        'provinces': [
            {'slot':  1, 'name': 'UnderDog',                    'ruler': 'Bakerman'},
            {'slot':  2, 'name': 'Rocket Raccoon',              'ruler': 'Steventhegreat'},
            {'slot':  3, 'name': 'Master Po',                   'ruler': 'Player'},
            {'slot':  4, 'name': 'Shazam',                      'ruler': 'Warbunny'},
            {'slot':  5, 'name': 'Boris Badenov',               'ruler': 'James Ford'},
            {'slot':  6, 'name': 'Ironman',                     'ruler': 'Tony Stark'},
            {'slot':  7, 'name': 'The Shoveler',                'ruler': 'Spade'},
            {'slot':  8, 'name': 'Thor',                        'ruler': 'MaoQi'},
            {'slot':  9, 'name': 'Mister Fantastic',            'ruler': 'Dr Reed Richards'},
            {'slot': 10, 'name': 'Malekith the Accursed',       'ruler': 'Angel'},
            {'slot': 11, 'name': 'The Valkyrie',                'ruler': 'Cork'},
            {'slot': 12, 'name': 'Thanos',                      'ruler': 'Jtm'},
            {'slot': 13, 'name': 'Radioactive Man',             'ruler': 'Wilfred'},
            {'slot': 14, 'name': 'Captain Hindsight',           'ruler': 'Devious'},
            {'slot': 15, 'name': 'General Zod',                 'ruler': 'Big Balls'},
            {'slot': 16, 'name': 'Ultron',                      'ruler': 'Witaba'},
            {'slot': 17, 'name': 'Madara',                      'ruler': 'Uchiha'},
            {'slot': 18, 'name': 'Mogo',                        'ruler': 'Sai'},
            {'slot': 19, 'name': 'Batman',                      'ruler': 'Robin'},
            {'slot': 20, 'name': 'Captain canada',              'ruler': 'Falco'},
            {'slot': 21, 'name': 'Superman',                    'ruler': 'Superman'},
            {'slot': 22, 'name': 'Spiderman',                   'ruler': 'MaL'},
            {'slot': 23, 'name': 'The Illuminati',              'ruler': 'Lightbringer'},
            {'slot': 24, 'name': 'GreatAruGLodArc',             'ruler': 'Kingsman_07'},
        ],
    },
]

# ── Identity helpers ───────────────────────────────────────────────────────────

def find_or_create_identity(identities, label):
    label_lower = label.lower()
    for identity in identities:
        if (identity.get('label') or '').lower() == label_lower:
            return identity
    identity = {
        'id':                   new_id(),
        'label':                label,
        'notes':                '',
        'kdHistory':            [],
        'rulersSeen':           [],
        'raceCounts':           {},
        'typicalProvinceCount': 0,
    }
    identities.append(identity)
    return identity

def update_identity(identity, provinces, age, location, kd_name):
    ruler_set = set(identity.get('rulersSeen') or [])
    for p in provinces:
        if p.get('ruler'):
            ruler_set.add(p['ruler'])

    kd_history = list(identity.get('kdHistory') or [])
    if not any(h.get('age') == age and h.get('location') == location for h in kd_history):
        kd_history.append({'age': age, 'location': location, 'kdName': kd_name or ''})

    prev = identity.get('typicalProvinceCount') or 0
    count = round((prev + len(provinces)) / 2) if prev else len(provinces)

    identity.update({
        'rulersSeen':           sorted(ruler_set),
        'kdHistory':            kd_history,
        'typicalProvinceCount': count,
    })

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("Loading existing identities from Firebase...")
    identities = fb_query('kd_identities')
    # Remove internal _docId helper field before processing
    for i in identities:
        i.pop('_docId', None)
    print(f"  {len(identities)} existing identit{'ies' if len(identities) != 1 else 'y'} loaded")

    saved = errors = 0

    for snap in SNAPSHOTS:
        label     = snap['identity']
        age       = snap['age']
        location  = snap['location']
        kd_name   = snap['kdName']
        provinces = [
            {
                'slot':        p['slot'],
                'name':        p['name'],
                'ruler':       p['ruler'],
                'race':        '',
                'personality': '',
                'land':        0,
            }
            for p in snap['provinces']
        ]

        snap_key = f"{age}_{location.replace(':', '-')}"
        print(f"\n  [{label}] {age} @ {location}  ->  {snap_key}")

        identity = find_or_create_identity(identities, label)
        update_identity(identity, provinces, age, location, kd_name)

        try:
            fb_write(f'kd_snapshots/{snap_key}', {
                'age':        age,
                'location':   location,
                'kdName':     kd_name,
                'savedAt':    '',
                'identityId': identity['id'],
                'provinces':  provinces,
            })
            fb_write(f'kd_identities/{identity["id"]}', identity)
            rulers = len([p for p in provinces if p['ruler']])
            print(f"    OK  snapshot saved  |  identity '{label}'  |  {rulers} rulers indexed")
            saved += 1
        except Exception as e:
            print(f"    ERR  Firebase write failed: {e}")
            errors += 1

    print(f"\n{'=' * 60}")
    print(f"  Done.  Saved: {saved}   Errors: {errors}")
    if saved:
        print(f"\n  Open the KD DATABASE tab in the Wave Planner to review.")

if __name__ == '__main__':
    main()
