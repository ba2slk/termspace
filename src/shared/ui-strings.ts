/**
 * Every user-facing chrome string, in both locales. Pure.
 *
 * The UI follows the system locale: Korean systems see the original Korean
 * copy, everyone else sees English. Diagnostics (config validation, console,
 * fatal dialogs) are English-only and live at their call sites, not here.
 *
 * Copy rules, both locales: name the setting, don't explain the mechanism;
 * menu items are actions. Korean must read as Korean, English as English —
 * neither is a translation of the other.
 */

const en = {
  /** main.ts: the empty canvas, the ☰ menu, sidebar context menu, dialogs, toasts. */
  firstRun: {
    appName: 'Termspace',
    windowTitle: (session: string) => `Termspace — ${session}`,
    // Under the four onboarding keys on the empty canvas
    moreKeys: 'The rest are in settings.',
    // ☰ menu
    closePane: 'Close pane',
    newSession: 'New session',
    saveLayout: 'Save this layout',
    saveLayoutAs: 'Save this layout as…',
    editSessionFile: 'Edit session file',
    hideSessionList: 'Hide session list',
    showSessionList: 'Show session list',
    settings: 'Settings',
    openSessionsDir: 'Open sessions folder',
    fullscreen: 'Full screen',
    devTools: 'Developer tools',
    quit: 'Quit',

    // Sidebar context menu
    refreshList: 'Refresh list',
    viewing: 'Viewing',
    open: 'Open',
    endSession: 'End session',
    deleteSession: 'Delete session',

    // Delete confirmation
    deleteTitle: 'Delete this session?',
    deleteLead: (id: string) => `Moves ${id}.yaml to the trash. If it is running, it stops too.`,
    deleteConfirm: 'Move to trash',
    deletedToast: 'Moved to the trash',
    deleteFailedToast: 'Could not delete',

    // Toasts
    sessionFileMissing: 'Session file not found',
    saved: (file: string) => `Saved · ${file}`,
    savedLayout: (file: string) => `Saved · ${file} · applies the next time it starts`,
    saveFailed: 'Could not save',
    copied: (chars: string) => `Copied · ${chars} chars`,

    // Close confirmation
    closeOneRunning: 'A session is running',
    closeManyRunning: (count: string) => `${count} sessions are running`,
    closeLead: 'Closing kills everything running inside. This cannot be undone.',
    closeConfirm: 'OK',
  },

  /** app-bar.ts: the title bar's buttons and split menu. */
  appBar: {
    brand: 'Termspace',
    menu: 'Menu',
    toggleSessionList: (chord: string) => `Hide/show session list (${chord})`,
    splitDirection: 'Split direction',
    save: (chord: string) => `Save this layout (${chord})`,
    splitUpItem: 'Split up',
    splitDownItem: 'Split down',
    addColumnLeft: 'Add a column to the left',
    addColumnRight: 'Add a column to the right',
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
  },

  /** session-sidebar.ts: the resident session list. */
  sidebar: {
    title: 'Sessions',
    refreshList: 'Refresh list',
    newSession: 'New session',
    emptyLead: 'No session files yet.',
    sessionsDir: '~/.config/termspace/sessions/',
    createExample: 'Create an example session',
    running: 'Running',
    wants: 'A pane here rang',
    endSession: 'End session',
    endSessionNamed: (name: string) => `End the ${name} session`,
  },

  /** session-runtime.ts: in-session notices. */
  runtime: {
    configError: 'Config error',
    spawnFailed: 'Could not start the shell',
  },

  /** save-session-view.ts: the save/new-session dialog. */
  saveSession: {
    title: 'Save as session',
    lead: "Saves the screen as it is now — each shell's place and running command included.",
    nameLabel: 'Name',
    cwdLabel: 'Base directory',
    browse: 'Choose…',
    cancel: 'Cancel (Esc)',
    namePrompt: 'Type a name',
    pathFor: (id: string) => `~/.config/termspace/sessions/${id}.yaml`,
    overwrite: 'Overwrite',
    create: 'Create',
    save: 'Save',
    nameTakenPickAnother: 'That name already exists. Pick another.',
    nameTakenOverwrites: 'That name already exists. Saving overwrites the session file it belongs to.',
    saveFailed: 'Could not save',
    blankTitle: 'New session',
    blankLead: 'Starts with one pane.',
  },

  /** settings-view.ts: the settings screen. */
  settings: {
    title: 'Settings',
    close: 'Close (Esc)',
    sectionAppearance: 'Appearance',
    sectionTerminal: 'Terminal',
    sectionMouse: 'Mouse',
    sectionFiles: 'Files',
    uiScaleLabel: 'Interface size',
    uiScaleDesc: "Scales the app's own text and title bar. It leaves the terminal's font size alone.",
    localeLabel: 'Language',
    localeDesc: 'Applied the next time the app starts.',
    localeSystem: 'Follow the system',
    tabGeneral: 'General',
    tabShortcuts: 'Shortcuts',
    off: 'Off',
    on: 'On',

    defaultColumnWidthLabel: 'Default column width',
    defaultColumnWidthDesc: 'Used when the session file has no width',
    fontSizeLabel: 'Font size',
    fontSizeDesc: 'Terminal font size',
    lineHeightLabel: 'Line height',
    lineHeightDesc: 'Space between lines',
    scrollbackLabel: 'Scrollback',
    scrollbackDesc: 'How many past lines each pane keeps',
    idleDimLabel: 'Dim inactive panes',
    idleDimDesc: '0 turns it off',
    scrollBoostLabel: 'Scroll boost',
    scrollBoostDesc: 'Wheel speed per notch. Fast rolls add up to 2.4× on top',
    unitPx: 'px',
    unitLines: 'lines',
    unitPercent: '%',
    unitTimes: '×',

    notificationsLabel: 'Desktop notifications',
    notificationsDesc: "A program's own notification reaches the desktop unless you are watching that pane",

    copyOnSelectLabel: 'Copy on select',
    copyOnSelectDesc: 'Mouse selections go straight to the clipboard',
    barPanningLabel: 'Horizontal scroll on the title',
    barPanningDesc: 'Rolling the wheel over the centre title pans the canvas',
    shiftPanningLabel: 'Shift + wheel horizontal scroll',
    shiftPanningDesc: 'Shift-rolling over a terminal pans the canvas too',

    fontLabel: 'Font',
    fontListFailed: 'Could not read the font list. Put the name in the settings file yourself',
    fontDesc: 'Terminal font. Only fixed-width fonts are listed',
    fontDefault: 'Default',
    fontMissing: (name: string) => `${name} — not installed`,
    paletteLabel: 'Palette',

    openSettingsFile: 'Open settings file',
    settingsFilePath: '~/.config/termspace/settings.yaml',
    openSessionsDir: 'Open sessions folder',
    sessionsDirPath: '~/.config/termspace/sessions/',
    openThemesDir: 'Open palettes folder',
    themesDirPath: '~/.config/termspace/themes/',
    openButton: 'Open',

    sectionShell: 'Shell integration',
    shellLead:
      'Add the line for your shell and a saved session records the alias you typed instead of what it expanded into.',
    shellCopy: 'Copy',
    shellCopied: 'Copied',
    shellActive: 'Loaded — this session is reporting commands',
    shellInactive: 'Not loaded yet',
    shellBash: 'bash — ~/.bashrc',
    shellZsh: 'zsh — ~/.zshrc',
    shellNote:
      'bash and zsh are supported. Panes already open keep the shell they started with, so reopen the session after adding the line.',

    resetRow: 'Restore the default for this setting',

    note: 'Columns, panes and commands come from the session file. Only what that file leaves unset is decided here.',
  },

  /** keybindings-view.ts: the Shortcuts tab of the settings screen. */
  keys: {
    searchPlaceholder: 'Search shortcuts',
    resetAll: 'Restore defaults',
    resetRow: 'Restore the default for this action',
    remove: 'Remove this shortcut',
    add: 'Add a shortcut',
    recording: 'Press a key…',
    unbound: 'None',
    noResults: 'Nothing matches that.',
    note: 'Saved to ~/.config/termspace/keybindings.yaml. Anything left at its default is not written.',

    groupPane: 'Panes',
    groupLayout: 'Layout',
    groupTerminal: 'Terminal',
    groupApp: 'App',

    riskControlChar: 'The terminal sends this as a control character.',
    riskShellWord: 'The shell uses this to move by word.',
    riskPlainKey: 'A key with no modifier is ordinary typing.',
    conflict: (actions: string) => `Also bound to ${actions}.`,

    'focus-left': 'Focus the pane to the left',
    'focus-right': 'Focus the pane to the right',
    'focus-up': 'Focus the pane above',
    'focus-down': 'Focus the pane below',
    'reveal-focus': 'Scroll back to the focused pane',
    overview: 'Open the overview map',
    'split-up': 'Split upwards',
    'split-down': 'Split downwards',
    'add-column-left': 'Add a column to the left',
    'add-column-right': 'Add a column to the right',
    'close-pane': 'Close the pane',
    'resize-left': 'Narrow the column',
    'resize-right': 'Widen the column',
    'resize-up': 'Shorten the pane',
    'resize-down': 'Heighten the pane',
    'move-left': 'Move the pane left',
    'move-right': 'Move the pane right',
    'move-up': 'Move the pane up',
    'move-down': 'Move the pane down',
    copy: 'Copy',
    paste: 'Paste',
    search: 'Search the scrollback',
    'font-increase': 'Larger font',
    'font-decrease': 'Smaller font',
    'font-reset': 'Default font size',
    'toggle-sidebar': 'Show or hide the session list',
    'goto-session': 'Jump to session 1–9',
    'prev-session': 'Previous open session',
    'next-session': 'Next open session',
    'save-layout': 'Save this layout',
    settings: 'Open settings',
    fullscreen: 'Full screen',
  },

  /** confirm-close-view.ts: shared confirmation dialog chrome. */
  confirmClose: {
    cancel: 'Cancel (Esc)',
    paneCount: (n: string) => `${n} panes`,
  },

  /** search-bar.ts: the scrollback search bar. */
  search: {
    placeholder: 'Search',
    matchCase: 'Match case',
    previousMatch: 'Previous match (Shift+Enter)',
    nextMatch: 'Next match (Enter)',
    close: 'Close (Esc)',
  },

  /** window-manager.ts: the mac application menu. Roles name themselves; these do not. */
  appMenu: {
    file: 'File',
    edit: 'Edit',
    copy: 'Copy',
    paste: 'Paste',
  },

  /** error-card.ts: config errors and exit banners shown in a pane's place. */
  errorCard: {
    configError: 'Config error',
    topLevel: '(top level)',
    exitedCode: (code: string) => `Exited · exit ${code}`,
    exitedSignal: (signal: string) => `Exited · signal ${signal}`,
    restart: 'Run again',
  },
} as const

/** Same keys and shapes as `en`, but any string will do — ko carries its own copy. */
type Widen<T> = T extends string ? string : T
type Catalog = {
  readonly [S in keyof typeof en]: { readonly [K in keyof (typeof en)[S]]: Widen<(typeof en)[S][K]> }
}

const ko: Catalog = {
  firstRun: {
    appName: 'Termspace',
    windowTitle: (session: string) => `Termspace — ${session}`,
    moreKeys: '나머지 단축키는 설정에 있습니다.',
    closePane: 'pane 닫기',
    newSession: '새 세션',
    saveLayout: '현재 배치 저장',
    saveLayoutAs: '다른 이름으로 저장…',
    editSessionFile: '세션 파일 편집',
    hideSessionList: '세션 목록 접기',
    showSessionList: '세션 목록 펴기',
    settings: '설정',
    openSessionsDir: '세션 폴더 열기',
    fullscreen: '전체 화면',
    devTools: '개발자 도구',
    quit: '종료',

    refreshList: '목록 새로고침',
    viewing: '열려 있음',
    open: '열기',
    endSession: '세션 끝내기',
    deleteSession: '세션 지우기',

    deleteTitle: '세션을 지울까요?',
    deleteLead: (id: string) => `${id}.yaml을 휴지통으로 보냅니다. 열려 있는 세션이면 함께 닫힙니다.`,
    deleteConfirm: '휴지통으로 보내기',
    deletedToast: '휴지통으로 보냈습니다',
    deleteFailedToast: '지우지 못했습니다',

    sessionFileMissing: '세션 파일을 찾을 수 없습니다',
    saved: (file: string) => `저장됨 · ${file}`,
    savedLayout: (file: string) => `저장됨 · ${file} · 다음 실행부터 적용`,
    saveFailed: '저장하지 못했습니다',
    copied: (chars: string) => `복사됨 · ${chars}자`,

    closeOneRunning: '실행 중인 세션이 있습니다',
    closeManyRunning: (count: string) => `실행 중인 세션이 ${count}개 있습니다`,
    closeLead: '닫으면 안에서 실행 중인 작업도 모두 끝납니다. 되돌릴 수 없습니다.',
    closeConfirm: '그래도 닫기',
  },

  appBar: {
    brand: 'Termspace',
    menu: '메뉴',
    toggleSessionList: (chord: string) => `세션 목록 접기/펴기 (${chord})`,
    splitDirection: '분할 방향',
    save: (chord: string) => `현재 배치 저장 (${chord})`,
    splitUpItem: '위로 분할하기',
    splitDownItem: '아래로 분할하기',
    addColumnLeft: '왼쪽에 새 컬럼 추가하기',
    addColumnRight: '오른쪽에 새 컬럼 추가하기',
    minimize: '최소화',
    maximize: '최대화',
    restore: '이전 크기로',
    close: '닫기',
  },

  sidebar: {
    title: '세션',
    refreshList: '목록 새로고침',
    newSession: '새 세션',
    emptyLead: '세션 파일이 없습니다.',
    sessionsDir: '~/.config/termspace/sessions/',
    createExample: '예시 세션 만들기',
    running: '실행 중',
    wants: '알림이 온 pane 있음',
    endSession: '세션 끝내기',
    endSessionNamed: (name: string) => `${name} 세션 끝내기`,
  },

  runtime: {
    configError: '설정 오류',
    spawnFailed: '셸을 시작하지 못했습니다',
  },

  saveSession: {
    title: '세션으로 저장',
    lead: '현재 배치와 각 셸에서 실행 중인 명령을 함께 저장합니다.',
    nameLabel: '이름',
    cwdLabel: '기준 디렉토리',
    browse: '찾아보기…',
    cancel: '취소 (Esc)',
    namePrompt: '이름을 적어 주세요',
    pathFor: (id: string) => `~/.config/termspace/sessions/${id}.yaml`,
    overwrite: '덮어쓰기',
    create: '만들기',
    save: '저장',
    nameTakenPickAnother: '같은 이름이 이미 있습니다. 다른 이름을 지어 주세요.',
    nameTakenOverwrites: '같은 이름이 이미 있습니다. 저장하면 기존 세션 파일을 덮어씁니다.',
    saveFailed: '저장하지 못했습니다',
    blankTitle: '새 세션',
    blankLead: 'pane 하나로 시작합니다.',
  },

  settings: {
    title: '설정',
    close: '닫기 (Esc)',
    sectionAppearance: '화면',
    sectionTerminal: '터미널',
    sectionMouse: '마우스',
    sectionFiles: '파일',
    uiScaleLabel: '화면 배율',
    uiScaleDesc: '앱 글자와 제목 표시줄만 조정합니다. 터미널 글자 크기에는 영향을 주지 않습니다.',
    localeLabel: '언어',
    localeDesc: '앱을 다시 시작하면 적용됩니다.',
    localeSystem: '시스템 설정 따르기',
    tabGeneral: '일반',
    tabShortcuts: '단축키',
    off: '끄기',
    on: '켜기',

    defaultColumnWidthLabel: '새 컬럼 기본 폭',
    defaultColumnWidthDesc: '세션 파일에 width가 없을 때 적용합니다',
    fontSizeLabel: '글자 크기',
    fontSizeDesc: '모든 터미널에 같이 적용됩니다',
    lineHeightLabel: '줄 간격',
    lineHeightDesc: '글줄 사이의 간격입니다',
    scrollbackLabel: '스크롤백',
    scrollbackDesc: 'pane마다 지난 출력을 이만큼 남깁니다',
    idleDimLabel: '비활성 pane 어둡게',
    idleDimDesc: '0이면 끕니다',
    scrollBoostLabel: '스크롤 가속',
    scrollBoostDesc: '휠을 빠르게 굴리면 최대 2.4배까지 더 빨라집니다',
    unitPx: 'px',
    unitLines: '줄',
    unitPercent: '%',
    unitTimes: '배',

    notificationsLabel: '데스크톱 알림',
    notificationsDesc: '보고 있지 않은 pane에서 온 알림을 데스크톱에 띄웁니다',

    copyOnSelectLabel: '선택하면 바로 복사',
    copyOnSelectDesc: '마우스로 선택한 글자를 클립보드에 복사합니다',
    barPanningLabel: '제목에서 가로 스크롤',
    barPanningDesc: '가운데 제목 위에서 휠을 굴리면 캔버스가 좌우로 움직입니다',
    shiftPanningLabel: 'Shift + 휠로 가로 스크롤',
    shiftPanningDesc: '터미널 위에서도 Shift를 누르고 굴리면 캔버스가 움직입니다',

    fontLabel: '글꼴',
    fontListFailed: '글꼴 목록을 읽지 못했습니다. 설정 파일에 이름을 직접 적어 주세요',
    fontDesc: '글자 폭이 일정한 글꼴만 보여 줍니다',
    fontDefault: '기본값',
    fontMissing: (name: string) => `${name} — 설치되어 있지 않음`,
    paletteLabel: '팔레트',

    openSettingsFile: '설정 파일 열기',
    settingsFilePath: '~/.config/termspace/settings.yaml',
    openSessionsDir: '세션 폴더 열기',
    sessionsDirPath: '~/.config/termspace/sessions/',
    openThemesDir: '팔레트 폴더 열기',
    themesDirPath: '~/.config/termspace/themes/',
    openButton: '열기',

    sectionShell: '셸 연동',
    shellLead:
      '쓰는 셸에 맞는 줄을 넣으면, 세션을 저장할 때 alias가 풀린 긴 명령 대신 직접 입력한 이름이 기록됩니다.',
    shellCopy: '복사',
    shellCopied: '복사함',
    shellActive: '연동됨 — 현재 세션의 명령을 기록합니다',
    shellInactive: '아직 연동되지 않음',
    shellBash: 'bash — ~/.bashrc',
    shellZsh: 'zsh — ~/.zshrc',
    shellNote:
      'bash와 zsh를 지원합니다. 이미 열려 있는 pane에는 바로 적용되지 않으니, 줄을 넣은 뒤 세션을 다시 여세요.',

    resetRow: '이 항목만 기본값으로',

    note: '컬럼·pane·명령은 세션 파일이 정합니다. 세션 파일에 적혀 있지 않은 값만 여기 설정을 따릅니다.',
  },

  keys: {
    searchPlaceholder: '단축키 검색',
    resetAll: '기본값으로 되돌리기',
    resetRow: '이 동작만 기본값으로',
    remove: '이 단축키 지우기',
    add: '단축키 추가',
    recording: '키를 누르세요…',
    unbound: '없음',
    noResults: '검색 결과가 없습니다.',
    note: '~/.config/termspace/keybindings.yaml에 저장합니다. 기본값 그대로인 항목은 적지 않습니다.',

    groupPane: 'pane',
    groupLayout: '배치',
    groupTerminal: '터미널',
    groupApp: '앱',

    riskControlChar: '터미널이 제어 문자로 보내는 키입니다.',
    riskShellWord: '셸이 단어 단위 이동에 쓰는 키입니다.',
    riskPlainKey: '조합 없는 키는 그냥 글자 입력입니다.',
    conflict: (actions: string) => `${actions}에도 걸려 있습니다.`,

    'focus-left': '왼쪽 pane으로 포커스',
    'focus-right': '오른쪽 pane으로 포커스',
    'focus-up': '위쪽 pane으로 포커스',
    'focus-down': '아래쪽 pane으로 포커스',
    'reveal-focus': '포커스한 pane으로 돌아가기',
    overview: '전체 지도 열기',
    'split-up': '위로 분할하기',
    'split-down': '아래로 분할하기',
    'add-column-left': '왼쪽에 컬럼 추가하기',
    'add-column-right': '오른쪽에 컬럼 추가하기',
    'close-pane': 'pane 닫기',
    'resize-left': '컬럼 좁히기',
    'resize-right': '컬럼 넓히기',
    'resize-up': 'pane 높이 줄이기',
    'resize-down': 'pane 높이 늘리기',
    'move-left': 'pane 왼쪽으로 옮기기',
    'move-right': 'pane 오른쪽으로 옮기기',
    'move-up': 'pane 위로 옮기기',
    'move-down': 'pane 아래로 옮기기',
    copy: '복사',
    paste: '붙여넣기',
    search: '스크롤백 검색',
    'font-increase': '글자 크게',
    'font-decrease': '글자 작게',
    'font-reset': '글자 크기 기본값',
    'toggle-sidebar': '세션 목록 보이기/숨기기',
    'goto-session': '1~9번 세션으로 이동',
    'prev-session': '이전에 열린 세션으로',
    'next-session': '다음에 열린 세션으로',
    'save-layout': '현재 배치 저장',
    settings: '설정 열기',
    fullscreen: '전체 화면',
  },

  confirmClose: {
    cancel: '취소 (Esc)',
    paneCount: (n: string) => `pane ${n}개`,
  },

  search: {
    placeholder: '검색',
    matchCase: '대소문자 구분',
    previousMatch: '이전 일치 (Shift+Enter)',
    nextMatch: '다음 일치 (Enter)',
    close: '닫기 (Esc)',
  },

  appMenu: {
    file: '파일',
    edit: '편집',
    copy: '복사',
    paste: '붙여넣기',
  },

  errorCard: {
    configError: '설정 오류',
    topLevel: '(최상위)',
    exitedCode: (code: string) => `종료됨 · exit ${code}`,
    exitedSignal: (signal: string) => `종료됨 · signal ${signal}`,
    restart: '다시 실행',
  },
}

export const STRINGS = { en, ko } as const

export type UiStrings = Catalog

export function stringsFor(locale: string): UiStrings {
  return locale === 'ko' || locale.startsWith('ko-') ? STRINGS.ko : STRINGS.en
}
