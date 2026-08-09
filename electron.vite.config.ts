import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * 프로덕션 CSP는 default-src 'none'으로 잠근다. 터미널에 표시되는 것은 전부 외부
 * 프로그램의 출력이므로 네트워크로 나가는 경로를 원천 차단한다.
 *
 * 다만 개발 중에는 vite HMR이 웹소켓을 쓴다. 개발 빌드에서만 그 예외를 넣고
 * 프로덕션 빌드에서는 자리표시자를 지운다. CSP를 통째로 느슨하게 두지 않는 이유다.
 */
function devCsp(): Plugin {
  return {
    name: 'termspace-dev-csp',
    transformIndexHtml(html, ctx) {
      const dev = ctx.server !== undefined
      return html.replace('<!--CSP_DEV-->', dev ? "; connect-src 'self' ws://localhost:*" : '')
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [devCsp()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
})
