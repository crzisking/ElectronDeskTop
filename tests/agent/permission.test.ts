import {describe, expect, it} from 'vitest'
import {
    decideFromConfig,
    gateDecide,
    isExternal,
    isHardDeniedCommand,
    isHardDeniedPath,
    matchPatternMap,
    suggestPattern,
} from '@main/agent/permission'
import type {PermissionConfig} from '@shared/types/agent.types'

describe('isHardDeniedCommand(硬編碼危險命令)', () => {
    it('危險命令 → true', () => {
        expect(isHardDeniedCommand('rm -rf /')).toBe(true)
        expect(isHardDeniedCommand('format c:')).toBe(true)
        expect(isHardDeniedCommand('shutdown /s')).toBe(true)
        expect(isHardDeniedCommand('echo hi && rm x')).toBe(true) // 中段也抓
    })
    it('安全命令 → false', () => {
        expect(isHardDeniedCommand('git status')).toBe(false)
        expect(isHardDeniedCommand('ls -la')).toBe(false)
        expect(isHardDeniedCommand('npm run build')).toBe(false)
    })
})

describe('isHardDeniedPath(系統路徑)', () => {
    it('系統目錄 → true', () => {
        expect(isHardDeniedPath('C:\\Windows\\System32\\drivers\\etc\\hosts')).toBe(true)
        expect(isHardDeniedPath('C:\\Program Files\\x')).toBe(true)
        expect(isHardDeniedPath('c:/windows/x')).toBe(true) // 斜線 + 大小寫
    })
    it('一般路徑 → false', () => {
        expect(isHardDeniedPath('C:\\Users\\me\\project\\a.ts')).toBe(false)
        expect(isHardDeniedPath('C:\\WindowsApps2\\x')).toBe(false) // 前綴不完整不誤判
    })
})

describe('matchPatternMap(glob 最後命中者贏)', () => {
    it('取最後命中的規則', () => {
        const map = {'git *': 'allow', 'git push *': 'deny'} as const
        expect(matchPatternMap('git push origin', map)).toBe('deny') // 兩者都中,後者贏
        expect(matchPatternMap('git status', map)).toBe('allow')
    })
    it('略過 "*" key;無命中回 null', () => {
        expect(matchPatternMap('ls', {'*': 'ask', 'rm *': 'deny'})).toBeNull()
    })
})

describe('decideFromConfig(宣告式決策)', () => {
    const cfg: PermissionConfig = {
        '*': 'ask',
        read: 'allow',
        edit: 'ask',
        bash: {'*': 'ask', 'git *': 'allow', 'rm *': 'deny'},
    }
    it('字串規則直接生效', () => {
        expect(decideFromConfig('read', '', cfg)).toBe('allow')
        expect(decideFromConfig('edit', '', cfg)).toBe('ask')
    })
    it('物件規則按 subject glob 比對', () => {
        expect(decideFromConfig('bash', 'git status', cfg)).toBe('allow')
        expect(decideFromConfig('bash', 'rm x', cfg)).toBe('deny')
        expect(decideFromConfig('bash', 'curl x', cfg)).toBe('ask') // 落該表 '*'
    })
    it('工具沒配 → 落全域 "*"', () => {
        expect(decideFromConfig('websearch', '', cfg)).toBe('ask')
    })
})

describe('gateDecide(靜態決策全流程)', () => {
    const base = {
        config: {'*': 'ask', read: 'allow', write: 'ask', external_directory: 'ask'} as PermissionConfig,
        workspaces: ['C:\\ws'],
        planMode: false
    }

    it('plan 模式擋寫類', () => {
        expect(gateDecide('write', {path: 'a.txt'}, {...base, planMode: true})).toBe('deny')
        expect(gateDecide('read', {path: 'a.txt'}, {...base, planMode: true})).toBe('allow')
    })
    it('硬編碼危險命令 → deny(即使 config 說 allow)', () => {
        const cfg = {...base, config: {...base.config, bash: 'allow'} as PermissionConfig}
        expect(gateDecide('bash', {command: 'rm -rf x'}, cfg)).toBe('deny')
    })
    it('系統路徑 → deny', () => {
        expect(gateDecide('read', {path: 'C:\\Windows\\x'}, base)).toBe('deny')
    })
    it('路徑出工作資料夾 → 套 external_directory(此處 ask)', () => {
        expect(gateDecide('read', {path: 'D:\\other\\x'}, base)).toBe('ask')
    })
    it('工作資料夾內 → 走工具本身 verdict', () => {
        expect(gateDecide('read', {path: 'C:\\ws\\a.ts'}, base)).toBe('allow')
        expect(gateDecide('write', {path: 'C:\\ws\\a.ts'}, base)).toBe('ask')
    })
})

describe('suggestPattern(「永遠」規則粒度)', () => {
    it('bash 取命令首兩詞 + " *"', () => {
        expect(suggestPattern('bash', 'git push origin main')).toBe('git push *')
        expect(suggestPattern('bash', 'ls')).toBe('ls *')
    })
    it('bash 空命令 → *', () => {
        expect(suggestPattern('bash', '   ')).toBe('*')
    })
    it('非 bash 工具 → *(整個工具粒度)', () => {
        expect(suggestPattern('write', 'C:\\ws\\a.ts')).toBe('*')
        expect(suggestPattern('read', '')).toBe('*')
    })
})

describe('isExternal(工作區邊界;前綴防兄弟目錄誤配)', () => {
    const ws = ['C:\\ws']
    it('工作區內 / 等於根 → false', () => {
        expect(isExternal('C:\\ws\\a.ts', ws)).toBe(false)
        expect(isExternal('C:\\ws', ws)).toBe(false)
    })
    it('兄弟前綴 C:\\ws2 → true(不因 startsWith 誤判在內)', () => {
        expect(isExternal('C:\\ws2\\a.ts', ws)).toBe(true)
    })
    it('完全在外 → true;大小寫 + 正斜線正規化', () => {
        expect(isExternal('D:\\other\\x', ws)).toBe(true)
        expect(isExternal('c:/WS/a.ts', ws)).toBe(false)
    })
    it('多工作區:命中任一即非 external', () => {
        expect(isExternal('D:\\proj\\x', ['C:\\ws', 'D:\\proj'])).toBe(false)
    })
})

describe('decideFromConfig fallthrough(glob 表無命中且全域 * 為物件 → ask)', () => {
    it('tool 表無命中 + 無表級 * + 全域 * 是物件 → ask', () => {
        const config: PermissionConfig = {bash: {'foo *': 'allow'}, '*': {'x': 'allow'}}
        expect(decideFromConfig('bash', 'git push', config)).toBe('ask')
    })
})
