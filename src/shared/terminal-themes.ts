/**
 * Terminal colour palettes. Pure data — no DOM, no xterm.
 *
 * Every bundled palette comes from its upstream project under MIT, with the
 * source and licence recorded per entry. The comment above each entry names the
 * exact upstream file the values were copied from; THIRD-PARTY-NOTICES.md
 * carries each project's licence text in full.
 */

/** 16 ANSI colours plus background, foreground and cursor. */
export interface TerminalTheme {
  readonly id: string
  readonly label: string
  /** Attribution, shown in the settings screen. */
  readonly credit: string
  readonly background: string
  readonly foreground: string
  readonly cursor: string
  readonly selection: string
  /**
   * The palette's signature colour, always one of its own sixteen.
   *
   * Chrome that wants to borrow the palette reads this rather than guessing:
   * every scheme has a colour it is known by, and it is not always the blue.
   */
  readonly accent: string
  readonly black: string
  readonly red: string
  readonly green: string
  readonly yellow: string
  readonly blue: string
  readonly magenta: string
  readonly cyan: string
  readonly white: string
  readonly brightBlack: string
  readonly brightRed: string
  readonly brightGreen: string
  readonly brightYellow: string
  readonly brightBlue: string
  readonly brightMagenta: string
  readonly brightCyan: string
  readonly brightWhite: string
}

/** Default palette, tuned to the app's panel background. */
export const DEFAULT_THEME: TerminalTheme = {
  id: 'termspace',
  label: 'Termspace',
  credit: "The app's default palette",
  background: '#1b1b1b',
  foreground: '#cfcbc4',
  cursor: '#cfcbc4',
  selection: 'rgba(255,255,255,0.14)',
  accent: '#7a9bbf',
  black: '#3a3733',
  red: '#cf7a6a',
  green: '#8aa872',
  yellow: '#d0a45c',
  blue: '#7a9bbf',
  magenta: '#a988b0',
  cyan: '#79a8a3',
  white: '#cfcbc4',
  brightBlack: '#6a655e',
  brightRed: '#e0907f',
  brightGreen: '#a3c088',
  brightYellow: '#e6bd74',
  brightBlue: '#94b4d6',
  brightMagenta: '#c3a2c8',
  brightCyan: '#93c1bb',
  brightWhite: '#e8e4dc',
}

const ZENBONES_CREDIT = 'Zenbones (MIT) — Michael Chris Lopez'
const DRACULA_CREDIT = 'Dracula (MIT) — Dracula Theme'

/**
 * Bundled palettes, copied from each project's own terminal export.
 *
 * All of them are dark: a terminal is read for hours against a dark canvas, and
 * a light palette in this list would only ever be picked by mistake.
 *
 * The default comes first; the rest are alphabetical by label.
 *
 * Ayu:         https://github.com/ayu-theme/vscode-ayu (MIT)
 * Catppuccin:  https://github.com/catppuccin/windows-terminal (MIT)
 * Dracula:     https://github.com/dracula/dracula-theme (MIT)
 * Everforest:  https://github.com/sainnhe/everforest (MIT)
 * GitHub:      https://github.com/primer/github-vscode-theme (MIT)
 * Gruvbox:     https://github.com/gruvbox-community/gruvbox (MIT)
 * Kanagawa:    https://github.com/rebelot/kanagawa.nvim (MIT)
 * Night Owl:   https://github.com/sdras/night-owl-vscode-theme (MIT)
 * Nightfox:    https://github.com/EdenEast/nightfox.nvim (MIT)
 * Nord:        https://github.com/nordtheme/xresources (MIT)
 * One Half:    https://github.com/sonph/onehalf (MIT)
 * Rosé Pine:   https://github.com/rose-pine/alacritty (MIT)
 * Solarized:   https://github.com/altercation/solarized (MIT)
 * Tokyo Night: https://github.com/enkia/tokyo-night-vscode-theme (MIT)
 * Tomorrow:    https://github.com/chriskempson/tomorrow-theme (MIT)
 * Zenbones:    https://github.com/zenbones-theme/zenbones.nvim (MIT)
 */
export const BUILT_IN_THEMES: readonly TerminalTheme[] = [
  DEFAULT_THEME,
  // ayu-dark.json, terminal.* (cursor from editorCursor.foreground, selection
  // from editor.selectionBackground).
  {
    id: 'ayu-dark',
    label: 'Ayu Dark',
    credit: 'Ayu (MIT) — Ike Kurghinyan',
    background: '#0d1017',
    foreground: '#bfbdb6',
    cursor: '#e6b450',
    selection: '#3388ff40',
    accent: '#fdb04c',
    black: '#1b1f29',
    red: '#f06b73',
    green: '#70bf56',
    yellow: '#fdb04c',
    blue: '#4fbfff',
    magenta: '#d0a1ff',
    cyan: '#93e2c8',
    white: '#c7c7c7',
    brightBlack: '#686868',
    brightRed: '#f07178',
    brightGreen: '#aad94c',
    brightYellow: '#ffb454',
    brightBlue: '#59c2ff',
    brightMagenta: '#d2a6ff',
    brightCyan: '#95e6cb',
    brightWhite: '#ffffff',
  },
  // catppuccin/windows-terminal, mocha.json.
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    credit: 'Catppuccin (MIT) — Catppuccin',
    background: '#1E1E2E',
    foreground: '#CDD6F4',
    cursor: '#F5E0DC',
    selection: '#585B70',
    accent: '#F5C2E7',
    black: '#45475A',
    red: '#F38BA8',
    green: '#A6E3A1',
    yellow: '#F9E2AF',
    blue: '#89B4FA',
    magenta: '#F5C2E7',
    cyan: '#94E2D5',
    white: '#BAC2DE',
    brightBlack: '#585B70',
    brightRed: '#F38BA8',
    brightGreen: '#A6E3A1',
    brightYellow: '#F9E2AF',
    brightBlue: '#89B4FA',
    brightMagenta: '#F5C2E7',
    brightCyan: '#94E2D5',
    brightWhite: '#A6ADC8',
  },
  // dracula/dracula-theme, the published terminal palette.
  {
    id: 'dracula',
    label: 'Dracula',
    credit: DRACULA_CREDIT,
    background: '#282A36',
    foreground: '#F8F8F2',
    cursor: '#F8F8F2',
    selection: '#44475A',
    accent: '#FF79C6',
    black: '#21222C',
    red: '#FF5555',
    green: '#50FA7B',
    yellow: '#F1FA8C',
    blue: '#BD93F9',
    magenta: '#FF79C6',
    cyan: '#8BE9FD',
    white: '#F8F8F2',
    brightBlack: '#6272A4',
    brightRed: '#FF6E6E',
    brightGreen: '#69FF94',
    brightYellow: '#FFFFA5',
    brightBlue: '#D6ACFF',
    brightMagenta: '#FF92DF',
    brightCyan: '#A4FFFF',
    brightWhite: '#FFFFFF',
  },
  // zenbones.nvim, extras/ terminal export.
  {
    id: 'duckbones',
    label: 'Duckbones',
    credit: ZENBONES_CREDIT,
    background: '#0E101A',
    foreground: '#EBEFC0',
    cursor: '#EDF2C2',
    selection: '#37382D',
    accent: '#00A3CB',
    black: '#0E101A',
    red: '#E03600',
    green: '#5DCD97',
    yellow: '#E39500',
    blue: '#00A3CB',
    magenta: '#795CCC',
    cyan: '#00A3CB',
    white: '#EBEFC0',
    brightBlack: '#2B2F46',
    brightRed: '#FF4821',
    brightGreen: '#58DB9E',
    brightYellow: '#F6A100',
    brightBlue: '#00B4E0',
    brightMagenta: '#B3A1E6',
    brightCyan: '#00B4E0',
    brightWhite: '#B3B692',
  },
  // colors/everforest.vim, s:terminal (dark medium); palette values from
  // autoload/everforest.vim. Upstream repeats the normal row as the bright row.
  {
    id: 'everforest-dark',
    label: 'Everforest Dark',
    credit: 'Everforest (MIT) — sainnhe',
    background: '#2d353b',
    foreground: '#d3c6aa',
    cursor: '#d3c6aa',
    selection: '#543a48',
    accent: '#a7c080',
    black: '#475258',
    red: '#e67e80',
    green: '#a7c080',
    yellow: '#dbbc7f',
    blue: '#7fbbb3',
    magenta: '#d699b6',
    cyan: '#83c092',
    white: '#d3c6aa',
    brightBlack: '#475258',
    brightRed: '#e67e80',
    brightGreen: '#a7c080',
    brightYellow: '#dbbc7f',
    brightBlue: '#7fbbb3',
    brightMagenta: '#d699b6',
    brightCyan: '#83c092',
    brightWhite: '#d3c6aa',
  },
  // src/theme.js, terminal.ansi* for the "dark" (default) theme, resolved
  // through @primer/primitives 7.10.0 dist/json/colors/dark.json.
  {
    id: 'github-dark',
    label: 'GitHub Dark',
    credit: 'GitHub (MIT) — Primer',
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#e6edf3',
    selection: 'rgba(255,255,255,0.14)',
    accent: '#58a6ff',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff',
  },
  // colors/gruvbox.vim: dark0/light1 for the ground, the neutral_* row for
  // normal, the bright_* row for bright, bg3 for selection.
  {
    id: 'gruvbox-dark',
    label: 'Gruvbox Dark',
    credit: 'Gruvbox (MIT) — Pavel Pertsev',
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#ebdbb2',
    selection: '#665c54',
    accent: '#d79921',
    black: '#282828',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#a89984',
    brightBlack: '#928374',
    brightRed: '#fb4934',
    brightGreen: '#b8bb26',
    brightYellow: '#fabd2f',
    brightBlue: '#83a598',
    brightMagenta: '#d3869b',
    brightCyan: '#8ec07c',
    brightWhite: '#ebdbb2',
  },
  // extras/alacritty_kanagawa.toml (wave).
  {
    id: 'kanagawa-wave',
    label: 'Kanagawa Wave',
    credit: 'Kanagawa (MIT) — Tommaso Laurenzi',
    background: '#1f1f28',
    foreground: '#dcd7ba',
    cursor: '#dcd7ba',
    selection: '#2d4f67',
    accent: '#7e9cd8',
    black: '#090618',
    red: '#c34043',
    green: '#76946a',
    yellow: '#c0a36e',
    blue: '#7e9cd8',
    magenta: '#957fb8',
    cyan: '#6a9589',
    white: '#c8c093',
    brightBlack: '#727169',
    brightRed: '#e82424',
    brightGreen: '#98bb6c',
    brightYellow: '#e6c384',
    brightBlue: '#7fb4ca',
    brightMagenta: '#938aa9',
    brightCyan: '#7aa89f',
    brightWhite: '#dcd7ba',
  },
  // themes/Night Owl-color-theme.json, terminal.ansi* (ground from
  // editor.background/foreground, cursor from editorCursor.foreground).
  {
    id: 'night-owl',
    label: 'Night Owl',
    credit: 'Night Owl (MIT) — Sarah Drasner',
    background: '#011627',
    foreground: '#d6deeb',
    cursor: '#80a4c2',
    selection: '#1b90dd4d',
    accent: '#82AAFF',
    black: '#011627',
    red: '#EF5350',
    green: '#22da6e',
    yellow: '#c5e478',
    blue: '#82AAFF',
    magenta: '#C792EA',
    cyan: '#21c7a8',
    white: '#ffffff',
    brightBlack: '#575656',
    brightRed: '#EF5350',
    brightGreen: '#22da6e',
    brightYellow: '#ffeb95',
    brightBlue: '#82AAFF',
    brightMagenta: '#C792EA',
    brightCyan: '#7fdbca',
    brightWhite: '#ffffff',
  },
  // extra/nightfox/alacritty.toml.
  {
    id: 'nightfox',
    label: 'Nightfox',
    credit: 'Nightfox (MIT) — James Simpson',
    background: '#192330',
    foreground: '#cdcecf',
    cursor: '#aeafb0',
    selection: '#2b3b51',
    accent: '#719cd6',
    black: '#393b44',
    red: '#c94f6d',
    green: '#81b29a',
    yellow: '#dbc074',
    blue: '#719cd6',
    magenta: '#9d79d6',
    cyan: '#63cdcf',
    white: '#dfdfe0',
    brightBlack: '#575860',
    brightRed: '#d16983',
    brightGreen: '#8ebaa4',
    brightYellow: '#e0c989',
    brightBlue: '#86abdc',
    brightMagenta: '#baa1e2',
    brightCyan: '#7ad5d6',
    brightWhite: '#e4e4e5',
  },
  // nordtheme/xresources, src/nord (nord0..nord15 -> ANSI); selection is nord2.
  {
    id: 'nord',
    label: 'Nord',
    credit: 'Nord (MIT) — Sven Greb',
    background: '#2E3440',
    foreground: '#D8DEE9',
    cursor: '#D8DEE9',
    selection: '#434C5E',
    accent: '#81A1C1',
    black: '#3B4252',
    red: '#BF616A',
    green: '#A3BE8C',
    yellow: '#EBCB8B',
    blue: '#81A1C1',
    magenta: '#B48EAD',
    cyan: '#88C0D0',
    white: '#E5E9F0',
    brightBlack: '#4C566A',
    brightRed: '#BF616A',
    brightGreen: '#A3BE8C',
    brightYellow: '#EBCB8B',
    brightBlue: '#81A1C1',
    brightMagenta: '#B48EAD',
    brightCyan: '#8FBCBB',
    brightWhite: '#ECEFF4',
  },
  // iterm/OneHalfDark.itermcolors. Upstream's bright black equals the
  // background, which hides dim text; the value here is the one Windows
  // Terminal ships for this same scheme (microsoft/terminal
  // src/cascadia/TerminalSettingsModel/defaults.json, MIT).
  {
    id: 'onehalf-dark',
    label: 'One Half Dark',
    credit: 'One Half (MIT) — Son A. Pham',
    background: '#282c34',
    foreground: '#dcdfe4',
    cursor: '#a3b3cc',
    selection: '#474e5d',
    accent: '#61afef',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#dcdfe4',
    brightBlack: '#5a6374',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#dcdfe4',
  },
  // rose-pine/alacritty, dist/rose-pine.toml (main variant).
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    credit: 'Rosé Pine (MIT) — Rosé Pine',
    background: '#191724',
    foreground: '#e0def4',
    cursor: '#524f67',
    selection: '#403d52',
    accent: '#eb6f92',
    black: '#26233a',
    red: '#eb6f92',
    green: '#31748f',
    yellow: '#f6c177',
    blue: '#9ccfd8',
    magenta: '#c4a7e7',
    cyan: '#ebbcba',
    white: '#e0def4',
    brightBlack: '#6e6a86',
    brightRed: '#eb6f92',
    brightGreen: '#31748f',
    brightYellow: '#f6c177',
    brightBlue: '#9ccfd8',
    brightMagenta: '#c4a7e7',
    brightCyan: '#ebbcba',
    brightWhite: '#e0def4',
  },
  // xresources/solarized, the dark half (color0..color15).
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    credit: 'Solarized (MIT) — Ethan Schoonover',
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    selection: '#073642',
    accent: '#268bd2',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  // themes/tokyo-night-color-theme.json, terminal.* (cursor from
  // editorCursor.foreground).
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    credit: 'Tokyo Night (MIT) — Enkia',
    background: '#16161e',
    foreground: '#787c99',
    cursor: '#c0caf5',
    selection: '#515c7e4d',
    accent: '#7aa2f7',
    black: '#363b54',
    red: '#f7768e',
    green: '#73daca',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#787c99',
    brightBlack: '#363b54',
    brightRed: '#f7768e',
    brightGreen: '#73daca',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#acb0d0',
  },
  // iTerm2/Tomorrow Night.itermcolors, except bright black, which that export
  // repeats as #000000; that one comes from Xdefaults/XresourceTomorrowNight
  // (*.color8), the repo's own terminal export.
  {
    id: 'tomorrow-night',
    label: 'Tomorrow Night',
    credit: 'Tomorrow (MIT) — Chris Kempson',
    background: '#1d1f21',
    foreground: '#c5c8c6',
    cursor: '#c5c8c6',
    selection: '#373b41',
    accent: '#81a2be',
    black: '#000000',
    red: '#cc6666',
    green: '#b5bd68',
    yellow: '#f0c674',
    blue: '#81a2be',
    magenta: '#b294bb',
    cyan: '#8abeb7',
    white: '#ffffff',
    brightBlack: '#666666',
    brightRed: '#cc6666',
    brightGreen: '#b5bd68',
    brightYellow: '#f0c674',
    brightBlue: '#81a2be',
    brightMagenta: '#b294bb',
    brightCyan: '#8abeb7',
    brightWhite: '#ffffff',
  },
  // zenbones.nvim, extras/ terminal export.
  {
    id: 'zenbones',
    label: 'Zenbones',
    credit: ZENBONES_CREDIT,
    background: '#1C1917',
    foreground: '#B4BDC3',
    cursor: '#C4CACF',
    selection: '#3D4042',
    accent: '#6099C0',
    black: '#1C1917',
    red: '#DE6E7C',
    green: '#819B69',
    yellow: '#B77E64',
    blue: '#6099C0',
    magenta: '#B279A7',
    cyan: '#66A5AD',
    white: '#B4BDC3',
    brightBlack: '#403833',
    brightRed: '#E8838F',
    brightGreen: '#8BAE68',
    brightYellow: '#D68C67',
    brightBlue: '#61ABDA',
    brightMagenta: '#CF86C1',
    brightCyan: '#65B8C1',
    brightWhite: '#888F94',
  },
  // zenbones.nvim, extras/ terminal export.
  {
    id: 'zenwritten',
    label: 'Zenwritten',
    credit: ZENBONES_CREDIT,
    background: '#191919',
    foreground: '#BBBBBB',
    cursor: '#C9C9C9',
    selection: '#404040',
    accent: '#6099C0',
    black: '#191919',
    red: '#DE6E7C',
    green: '#819B69',
    yellow: '#B77E64',
    blue: '#6099C0',
    magenta: '#B279A7',
    cyan: '#66A5AD',
    white: '#BBBBBB',
    brightBlack: '#3D3839',
    brightRed: '#E8838F',
    brightGreen: '#8BAE68',
    brightYellow: '#D68C67',
    brightBlue: '#61ABDA',
    brightMagenta: '#CF86C1',
    brightCyan: '#65B8C1',
    brightWhite: '#8E8E8E',
  },
]

/** Falls back to the default palette so an unknown name can't break startup. */
export function themeById(id: string, extra: readonly TerminalTheme[] = []): TerminalTheme {
  return [...BUILT_IN_THEMES, ...extra].find((t) => t.id === id) ?? DEFAULT_THEME
}
