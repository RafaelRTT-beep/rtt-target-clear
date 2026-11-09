// Leveldata voor RTT Target Clear.
//
// rooms : rastercellen van 1,34 m (paneelmaat RTT-hal). Elke letter is een ruimte.
//         Tussen verschillende letters komt automatisch een paneelwand.
//         Hoofdletter = ruimte met stenen behang aan de binnenkant. ' ' = buiten het veld.
// ents  : zelfde raster, per cel één ding:
//         S schijf (shoot)     N schijf (no-shoot)    O stalen popper
//         R draaischijf shoot  Q draaischijf no-shoot
//         E verdachte pistool  F verdachte geweer     G verdachte die "piekt"
//         C burger handen omhoog  c burger gehurkt    H gijzelnemer + gijzelaar
//         B ton   K kratten   P pallets   T tafel   Y banden
//         X finish
// edges : "x,z,kant,type" op de rand van cel (x,z). kant n/e/s/w.
//         type d deur, w raam, l lexaan, o open (geen paneel), x extra wand, # behangwand
// face  : "x,z": "n|e|s|w" om de kijkrichting van een schijf/figuur vast te zetten

export const LEVELS = [
  {
    id: 1,
    code: 'L1',
    name: 'KWALIFICATIE',
    sub: 'Shoot / no-shoot parcours',
    mode: 'targets',
    brief: 'Het klassieke RTT-killhouse. Werk de gang af, clear alle zes de kamers en eindig in het finishvak. Raak elke shoot-schijf twee keer of één keer in het hoofd. Poppers vallen bij één treffer.',
    rules: ['Gemiste shoot-schijf: +5 s', 'No-shoot geraakt: +10 s', 'Tijd stopt in het finishvak'],
    par: [38, 52, 70, 95], // S A B C (eindtijd in seconden)
    start: { x: 0, z: 4, dir: 'e' },
    rooms: [
      'aaaabbbbcccc',
      'aaaabbbbcccc',
      'aaaabbbbcccc',
      'aaaabbbbcccc',
      'hhhhhhhhhhhh',
      'ddddEEEEffff',
      'ddddEEEEffff',
      'ddddEEEEffff',
      'ddddEEEEffff',
    ],
    ents: [
      'S.N.OSO.YQ.S',
      '...K.....R..',
      'B..S...N....',
      '............',
      '...........X',
      '...S.......N',
      '.......N....',
      'B.......B..O',
      'S..NS.NS.SR.',
    ],
    edges: [
      '1,3,s,d', '6,3,s,d', '10,3,s,d',
      '2,5,n,d', '6,5,n,d', '4,5,n,l', '9,5,n,d',
      '3,1,e,w', '7,6,e,w',
      '2,1,s,x', '9,7,n,x', '9,7,e,x',
    ],
    face: {},
    fog: 0.010,
    smoke: 0,
  },
  {
    id: 2,
    code: 'L2',
    name: 'HUISZOEKING',
    sub: 'Woning clearen, burgers sparen',
    mode: 'combat',
    brief: 'Melding van gewapende verdachten in een woning. Er zijn burgers binnen. Doorzoek elke kamer, schakel alle verdachten uit en raak geen burgers. Verdachten schieten terug: neem bochten ruim en gebruik dekking.',
    rules: ['Alle verdachten uitschakelen', 'Burger geraakt: +15 s, bij 3 mislukt', 'Je herstelt als je even uit het vuur blijft'],
    par: [55, 75, 100, 140],
    start: { x: 6, z: 9, dir: 'n' },
    rooms: [
      'WWWWWWkkkkSSSS',
      'WWWWWWkkkkSSSS',
      'WWWWWWkkkkSSSS',
      'WWWWWWhhhhhhhh',
      'WWWWWWhbbbTTTT',
      'WWWWWWhbbbTTTT',
      'gggggghbbbTTTT',
      'gggggghcccTTTT',
      'gggggghcccTTTT',
      'gggggghcccTTTT',
    ],
    ents: [
      'E..C.....EC..E',
      '..............',
      '..T......B...K',
      '..............',
      'F........c....',
      '..........F..C',
      'K....K........',
      '.........P....',
      '...E.......G..',
      'E........EC..E',
    ],
    edges: [
      '6,4,w,d', '6,1,w,o', '7,3,n,d', '11,3,n,d', '12,4,n,d',
      '7,5,w,d', '6,8,w,d', '7,8,w,d',
      '2,6,n,w', '10,1,w,l', '3,6,n,d',
      '11,7,n,x', '12,7,n,x',
    ],
    face: {},
    fog: 0.012,
    smoke: 0.15,
  },
  {
    id: 3,
    code: 'L3',
    name: 'ENTRESOL',
    sub: 'Rook, overmacht en een gijzeling',
    mode: 'combat',
    brief: 'De hal staat vol rook. Schutters op de entresol hebben het open veld onder vuur. Clear de kamers, ga de trap op en maak de entresol vrij. Boven houdt een verdachte een gijzelaar vast: alleen een precisieschot is veilig.',
    rules: ['Alle verdachten uitschakelen', 'Gijzelaar geraakt: missie mislukt', 'Schutters boven zien je in het open veld'],
    par: [80, 110, 150, 210],
    start: { x: 5, z: 11, dir: 'n' },
    rooms: [
      'AAAAAbbbbmmmmmmm',
      'AAAAAbbbbmmmmmmm',
      'AAAAAbbbbmmmnnnn',
      'AAAAAbbbbmmmnnnn',
      '.....ssssmmmnnnn',
      '................',
      '..cccc....DDDD..',
      '..cccc....DDDD..',
      '..cccc....DDDD..',
      '................',
      'eeee.......ffff.',
      'eeee.......ffff.',
    ],
    ents: [
      '...cF.C.E.G...E.',
      'E...............',
      '..........K.C...',
      '...............E',
      'B...............',
      '..............B.',
      '..E........Y.F..',
      '.........K......',
      '............Ec..',
      'K..G.......B....',
      'E.............P.',
      '...........E....',
    ],
    edges: [
      '2,4,n,d', '5,1,w,d', '9,1,w,d', '10,5,n,d', '14,5,n,d', '12,3,w,l',
      '3,6,n,d', '5,7,e,d', '11,8,s,d', '10,7,w,d',
      '2,10,n,d', '12,10,n,d', '5,4,w,o',
      '13,7,e,w', '2,2,e,x',
    ],
    face: {},
    mezz: {
      x0: 9, z0: 0, x1: 15, z1: 4, h: 2.84,
      ents: [
        '......H',
        '.K.....',
        '....K..',
        '.......',
        '.F...F.',
      ],
      face: { '10,4': 's', '14,4': 's', '15,0': 'w' },
    },
    stairs: { x0: 5, z0: 4, x1: 8, z1: 4, dir: 'e' },
    fog: 0.022,
    smoke: 1,
  },
];
