<p align="center">
  <img src="build/icon-256.png" alt="" width="96" height="96" />
</p>

<h1 align="center">Termspace</h1>

<p align="center">
  화면 밖으로 이어지는 터미널 작업 공간
</p>

<p align="center">
  <a href="https://github.com/ba2slk/termspace/releases"><img src="https://img.shields.io/github/v/release/ba2slk/termspace?style=flat&color=08C" alt="최신 릴리스" /></a>
  <img src="https://img.shields.io/badge/license-MIT-08C?style=flat" alt="License: MIT" />
  <img src="https://img.shields.io/badge/Linux-4493F8?style=flat" alt="지원 플랫폼: Linux" />
  <img src="https://img.shields.io/badge/macOS-4493F8?style=flat" alt="지원 플랫폼: macOS" />
</p>

<p align="center"><a href="README.md">English</a></p>

<p align="center">
  <img src="docs/media/termspace.gif" alt="저장해 둔 세션을 열고, 캔버스를 가로지르고, Alt+M 오버뷰를 여는 장면" width="100%" />
</p>

Termspace는 화면보다 넓은 캔버스에 터미널 패인을 늘어놓습니다. 화면 밖에 있는 패인도
사라진 게 아니라 옆에 그대로 있고, 포커스를 옮기면 캔버스가 그쪽으로 스크롤됩니다.

창을 좁혀도 패인은 좁아지지 않습니다. 보이는 캔버스 범위가 줄어들 뿐, 에디터와 로그와
셸의 너비는 그대로입니다.

레이아웃은 파일로 남습니다. 원하는 모양으로 짜서 YAML로 저장해 두면 다음에 열 때도
컬럼 구성과 너비가 같고, 같은 디렉토리에서 같은 명령이 실행됩니다.

노트북 화면에 필요한 창이 다 안 들어올 때, 프로젝트를 여러 개 열어두고 오갈 때,
오래 걸리는 작업이나 에이전트를 띄워두고 다른 일을 할 때 유용합니다.

**리눅스와 macOS**를 지원합니다. 윈도우는 지원하지 않습니다.

## 기능

| 기능 | 설명 |
|---|---|
| `Alt` / `Cmd` + 방향키로 포커스 이동 | 누른 방향의 패인으로 포커스가 넘어가고, 캔버스도 그 패인이 보이는 위치까지 스크롤됩니다. 접두 키를 먼저 누르거나 창 번호를 외우지 않아도 됩니다. |
| 컬럼 너비는 픽셀 고정 | 컬럼 너비는 창에 대한 비율이 아니라 픽셀 값입니다. 창 크기를 바꾸면 캔버스가 보이는 범위만 달라지고, 패인 너비는 변하지 않습니다. |
| 세션 전체 보기 (`Alt` + `M` / `Cmd+Shift+M`) | 캔버스 전체를 한 화면 크기로 줄여서 보여줍니다. 카드마다 패인 제목과 실행 중인 명령이 적혀 있고, 방향키나 클릭으로 해당 패인으로 이동하고, `F2`로 고른 카드의 이름을 바꿉니다. |
| 현재 레이아웃을 세션으로 저장 | 패인을 나누고, 셸마다 `cd` 하고, 명령을 실행해 둔 다음 저장합니다. 컬럼 너비와 패인 비율, 셸별 작업 디렉토리, 실행 중이던 명령이 새 YAML 파일에 기록됩니다. |
| 세션 하나에 YAML 파일 하나 | 세션 파일은 `~/.config/termspace/sessions/`에 둡니다. 앱은 이 파일을 읽기만 하고 알아서 고쳐 쓰지 않습니다. 실행 중에 패인을 나누거나 크기를 바꿔도 파일은 그대로입니다. 세션 목록에서 오른쪽 클릭하면 이름을 바꿀 수 있습니다. `name:` 줄과 함께 파일 이름도 새 이름을 따라가고, 나머지는 적어둔 그대로 남습니다. |
| 세션 전환 | 세션 목록 위에서 휠을 굴리면 한 칸씩 넘어갑니다. `Alt` + `1`~`9`는 해당 세션을 바로 열고, 지금 세션의 번호를 한 번 더 누르면 직전 세션으로 돌아옵니다. |
| 마우스로 캔버스 이동과 크기 조절 | 가로 휠이 없는 마우스를 위해, 타이틀바 가운데에서 휠을 굴리면 캔버스가 좌우로 움직입니다. 어디서든 `Shift` + 휠도 같은 동작입니다. 패인 사이의 틈은 잡아끌면 크기 조절 핸들이 됩니다. |
| 화면 밖 패인의 알림 | 패인에서 벨이 울리면 세션 목록에 표시가 남습니다. `OSC 9`과 `OSC 777` 알림은 데스크톱 알림으로도 뜨는데, 그때 그 패인을 보고 있었다면 보내지 않습니다. |

## 설치

빌드는 [Releases](https://github.com/ba2slk/termspace/releases)에 올라옵니다. 소스에서
빌드하는 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다.

### 리눅스

AppImage를 받습니다.

```bash
chmod +x Termspace-*.AppImage
./Termspace-*.AppImage
```

<details>
<summary>실행하자마자 샌드박스 오류를 내며 죽는다면</summary>

Ubuntu 24.04부터 비특권 user namespace를 막는 AppArmor 정책이 기본으로 들어갑니다.
Electron 샌드박스가 이 기능을 쓰기 때문에 생기는 문제입니다. `--no-sandbox`를 붙이면
실행은 되고, 아래처럼 프로파일을 등록하면 샌드박스를 켠 채로 쓸 수 있습니다.

```bash
sudo tee /etc/apparmor.d/termspace >/dev/null <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>
profile termspace /home/*/Applications/Termspace.AppImage flags=(unconfined) {
  userns,
  include if exists <local/termspace>
}
PROFILE
sudo apparmor_parser -r /etc/apparmor.d/termspace
```

어느 쪽이든 렌더러 격리와 CSP는 그대로 동작합니다.

</details>

### macOS

Releases에서 아키텍처에 맞는 dmg를 받습니다 (애플 실리콘은 `arm64`, 인텔은 `x64`).

**첫 실행.** Termspace는 ad-hoc 서명만 되어 있고 공증(notarization)을 받지 않아서,
Gatekeeper가 첫 실행을 막습니다. "손상되었습니다" 또는 "확인되지 않은 개발자"라고 뜨는데,
둘 다 내려받은 파일에 macOS의 격리(quarantine) 표시가 붙어 있다는 뜻이고 파일 자체는
멀쩡합니다. 아래 중 하나를 한 번만 하면 됩니다.

- **터미널:** Termspace.app을 응용 프로그램으로 옮긴 뒤
  `xattr -dr com.apple.quarantine /Applications/Termspace.app`
- **터미널 없이:** 더블 클릭해서 한 번 막힌 다음, 시스템 설정 → 개인정보 보호 및 보안 →
  "그래도 열기". macOS 14 이하에서는 우클릭 → 열기도 됩니다.
- **소스에서 빌드:** `npm install && npm run dist:mac` — 직접 빌드한 앱에는 격리 표시가
  붙지 않습니다.

## 세션

세션 하나가 YAML 파일 하나입니다. 컬럼은 왼쪽에서 오른쪽 순서로, 패인은 위에서 아래
순서로 적습니다.

```yaml
name: dev
cwd: "~/dev/projects/app"     # 따옴표 없는 ~ 는 YAML에서 null 입니다

columns:
  - width: 720                # px. 창이 좁아져도 줄지 않습니다
    panes:
      - title: editor
        command: nvim .
      - title: shell
        height: 0.3           # 컬럼 안에서의 세로 비율

  - width: 900
    panes:
      - title: server
        cwd: ./backend        # 세션 cwd 기준 상대 경로
        command: uv run fastapi dev
```

`command`는 셸을 대체하지 않습니다. 직접 키를 친 것처럼 셸에 타이핑될 뿐입니다. 그래서
프로그램이 종료돼도 프롬프트가 남고, 그 자리에서 다시 실행하면 됩니다. 명령을 프롬프트에
적어만 두고 실행은 하지 않으려면 `prefill`을 씁니다.

직접 쓰지 않아도 됩니다. 앱에서 레이아웃을 잡고 저장하면 같은 파일이 만들어집니다
(`Alt+Shift` + `S`, 또는 ☰ › 현재 레이아웃 저장). 저장이 무엇까지 담는지는
**[docs/sessions.md](docs/sessions.md)**에 정리해 두었습니다.

detach/attach 기능은 없습니다. 창을 닫으면 안에서 돌던 프로세스도 함께 종료되기 때문에,
무엇이 종료되는지 먼저 보여주고 확인을 받습니다. 창보다 오래 살아야 하는 작업은 패인
안에서 tmux를 쓰면 됩니다. Termspace가 대신하는 건 tmux의 *윈도우*지 tmux 자체가
아닙니다.

## 단축키

| Linux | macOS | 동작 |
|---|---|---|
| `Alt` + `←→↑↓` | `Cmd` + `←→↑↓` | 포커스 이동 |
| `Alt+Shift` + `↑` / `↓` | `Cmd+Shift` + `↑` / `↓` | 위 / 아래로 분할 |
| `Alt+Shift` + `←` / `→` | `Cmd+Shift` + `←` / `→` | 왼쪽 / 오른쪽에 새 컬럼 |
| `Alt+Shift` + `W` | `Cmd+Shift` + `W` | 패인 닫기 |
| `Alt` + `U` `I` `O` `P` | `Cmd` + `U` `I` `O` `P` | 크기 조절. 한 줄에 나란한 네 키를 vim 방향 순서로 |
| `Alt+Shift` + `U` `I` `O` `P` | `Cmd+Shift` + `U` `I` `O` `P` | 패인 자체를 옮기기 |
| `Alt` + `M` | `Cmd+Shift+M` | 세션 전체 보기 |
| `F2` | `F2` | 세션 전체 보기에서 선택한 패인 이름 바꾸기 |
| `Alt` + `S` | `Cmd` + `B` | 세션 사이드바 여닫기 |
| `Alt` + `G` | `Cmd` + `G` | 포커스된 패인으로 되돌아가기 |
| `Alt` + `1`~`9` | `Cmd` + `1`~`9` | 세션으로 점프. 같은 번호를 다시 누르면 직전 세션으로 |
| `Alt+Shift` + `<` / `>` | `Cmd+Shift` + `[` / `]` | 열려 있는 세션 사이 이전 / 다음 |
| `Alt+Shift` + `S` | `Cmd` + `S` | 지금 레이아웃을 세션 파일에 덮어쓰기 |
| `Ctrl+Shift` + `F` | `Cmd` + `F` | 패인 스크롤백 검색 |
| `Ctrl+Shift` + `C` / `V` | `Cmd` + `C` / `V` | 복사 / 붙여넣기 |
| `Ctrl` + `+` / `-` / `0` | `Cmd` + `+` / `-` / `0` | 글자 크기 |
| `Ctrl` + `,` | `Cmd` + `,` | 설정 |
| `Shift` + 휠 | `Shift` + 휠 | 캔버스 가로 이동 |

나머지 키 입력은 모두 포커스된 패인으로 그대로 전달됩니다. 위 단축키는 `Ctrl` + `,`(`⌘Cmd` + `,`) ›
단축키에서 전부 바꿀 수 있습니다.

## 설정

`Ctrl` + `,`(`⌘Cmd` + `,`)에서 터미널 글꼴과 크기, 인터페이스 크기, 언어(English / 한국어), 마우스와
알림 동작을 바꿉니다. 팔레트는 **14종**이 기본으로 들어 있습니다.
[Zenbones](https://github.com/zenbones-theme/zenbones.nvim) 계열과 Dracula, Termspace
기본 팔레트입니다. 직접 만든 팔레트는 `~/.config/termspace/themes/`에 YAML로 넣어두면
목록에 같이 나옵니다.

## 개발

설치와 테스트 명령, PR 기준은 [CONTRIBUTING.md](CONTRIBUTING.md)에 있습니다.

저는 기능 기획과 사용성 개선에 집중하고, 구현은 Claude Code와 스펙을 먼저 쓰는
방식으로 진행했습니다. 모든 변경은 테스트와 앱의 [자체 점검](docs/MANUAL-QA.md)을
거칩니다.

## 라이선스

MIT입니다. 함께 담긴 팔레트도 같습니다 ([고지](THIRD-PARTY-NOTICES.md)).
