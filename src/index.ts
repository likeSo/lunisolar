import { Lunisolar } from './class/lunisolar'
import { Lunar } from './class/lunar'
import { SolarTerm } from './class/solarTerm'
import { Char8 } from './class/char8'
import { SB, Stem, Branch } from './class/stemBranch'
import { Element5 } from './class/element5'
import { Trigram8 } from './class/trigram8'
import { Direction24 } from './class/direction24'
import { _GlobalConfig } from './config'
import { parseFromLunar, defineLocale } from './utils'
import zh from './locale/zh'
import { Markers } from './class/markers'
import { FIRST_YEAR, LAST_YEAR } from './constants/lunarData'
import { computeRatStem } from './utils'
import { FromSBConfig } from '../typings'

export default function lunisolar(
  date?: DateConfigType | Lunisolar,
  config?: ConfigType
): Lunisolar {
  return new Lunisolar(date, config)
}

lunisolar.utc = function (date?: DateConfigType | Lunisolar, config?: ConfigType): Lunisolar {
  return new Lunisolar(date, Object.assign({}, config, { isUTC: true }))
}

lunisolar.Lunar = Lunar
lunisolar.SolarTerm = SolarTerm
lunisolar.Char8 = Char8
lunisolar.SB = SB
lunisolar.Stem = Stem
lunisolar.Branch = Branch
lunisolar.Element5 = Element5
lunisolar.Lunisolar = Lunisolar
lunisolar.Trigram8 = Trigram8
lunisolar.Direction24 = Direction24

lunisolar.fromLunar = function (
  param: ParseFromLunarParam,
  config?: SettingGlobalConfig
): Lunisolar {
  const date = parseFromLunar(param, config?.lang)
  return new Lunisolar(date, config)
}

/**
 * 根据年、月、日、时四柱反查公历时间。
 *
 * 注意：四柱不包含年份范围，因此返回值始终是数组。
 * 如果未指定 fromYear/toYear，则使用农历数据支持的完整年份范围。
 *
 * 子时返回 00:00 作为代表时间。实际上子时还包含前一日 23:00，
 * 但由于本库在 23:00 换日，使用 00:00 可以避免返回重复结果。
 */
lunisolar.fromSB = function (
  param: [SB, SB, SB, SB] | [string, string, string, string],
  config?: FromSBConfig
): Lunisolar[] {
  if (!Array.isArray(param) || param.length !== 4) {
    throw new Error('Invalid SB param: expected [year, month, day, hour]')
  }

  const cfg = Object.assign({}, _GlobalConfig, config)
  const lang = cfg.lang || _GlobalConfig.lang

  const list: [SB, SB, SB, SB] = param.map(item => {
    if (item instanceof SB) return item

    const value = SB.getNames(lang).indexOf(item)
    if (value < 0) {
      throw new Error(`Invalid SB value: ${item}`)
    }

    return new SB(value, undefined, { lang })
  }) as [SB, SB, SB, SB]

  const [yearSB, monthSB, daySB, hourSB] = list

  const fromYear = Math.max(
    FIRST_YEAR,
    config?.fromYear ?? FIRST_YEAR
  )
  const toYear = Math.min(
    LAST_YEAR,
    config?.toYear ?? LAST_YEAR
  )

  if (
    !Number.isInteger(fromYear) ||
    !Number.isInteger(toYear) ||
    fromYear > toYear
  ) {
    throw new Error('Invalid fromSB year range')
  }

  const isUTC = Boolean(cfg.isUTC)
  const char8Config = {
    lang,
    isUTC,
    offset: cfg.offset ?? 0,
    changeAgeTerm:
      cfg.changeAgeTerm === undefined
        ? _GlobalConfig.changeAgeTerm
        : cfg.changeAgeTerm
  }

  const makeDate = (year: number, month: number, day: number, hour: number) => {
    if (isUTC) {
      return new Date(Date.UTC(year, month, day, hour, 0, 0, 0))
    }

    return new Date(year, month, day, hour, 0, 0, 0)
  }

  const getYear = (date: Date) =>
    isUTC ? date.getUTCFullYear() : date.getFullYear()

  const getMonth = (date: Date) =>
    isUTC ? date.getUTCMonth() : date.getMonth()

  const getDate = (date: Date) =>
    isUTC ? date.getUTCDate() : date.getDate()

  const addDays = (date: Date, days: number) => {
    const result = new Date(date.valueOf())

    if (isUTC) {
      result.setUTCDate(result.getUTCDate() + days)
    } else {
      result.setDate(result.getDate() + days)
    }

    return result
  }

  const results: Lunisolar[] = []

  /*
   * 由年柱确定可能的干支年。
   *
   * 这里的 year 是“立春年”，例如：
   *   2024 年立春之后为甲辰年；
   *   2024 年元旦至立春前仍然属于癸卯年。
   *
   * 因此每个候选干支年检查 [year-01-01, year+1-01-01)。
   */
  for (let year = fromYear - 1; year <= toYear + 1; year++) {
    const yearSBByNumber = new SB(
      (year - 4) % 60,
      undefined,
      { lang }
    )
    const prevYearSBByNumber = new SB(
      (year - 5) % 60,
      undefined,
      { lang }
    )

    if (
      yearSBByNumber.value !== yearSB.value &&
      prevYearSBByNumber.value !== yearSB.value
    ) {
      continue
    }

    const rangeStart = makeDate(year, 0, 1, 0)
    const rangeEnd = makeDate(year + 1, 0, 1, 0)

    /*
     * 用甲子日锚点计算该公历年份内第一个目标日柱。
     * 日柱每 60 天重复一次，因此后续只需每次跳 60 天。
     *
     * 这里用 Char8.computeSBDay，而不是简单使用日期差，
     * 这样可以严格复用本库的 23:00 换日规则。
     */
    let day = rangeStart
    let firstDayFound: Date | null = null

    for (let i = 0; i < 61; i++) {
      const current = addDays(rangeStart, i)

      if (Char8.computeSBDay(current, char8Config).value === daySB.value) {
        firstDayFound = current
        break
      }
    }

    if (!firstDayFound) continue

    for (
      day = firstDayFound;
      day.valueOf() < rangeEnd.valueOf();
      day = addDays(day, 60)
    ) {
      /*
       * 五鼠遁：
       *
       * 甲己还加甲，乙庚丙作初；
       * 丙辛从戊起，丁壬庚子居；
       * 戊癸起壬子，周而复始求。
       *
       * 目标时柱的地支可以直接确定小时，
       * 再根据日干反推时干。
       */
      const hourBranch = hourSB.branch.value
      const hour = hourBranch === 0 ? 0 : hourBranch * 2

      const expectedHourStem = computeRatStem(
        daySB.stem.value,
        hourBranch
      )

      if (expectedHourStem !== hourSB.stem.value) continue

      const candidate = makeDate(
        getYear(day),
        getMonth(day),
        getDate(day),
        hour
      )

      const actual = new Char8(candidate, char8Config)

      if (
        actual.year.value !== yearSB.value ||
        actual.month.value !== monthSB.value ||
        actual.day.value !== daySB.value ||
        actual.hour.value !== hourSB.value
      ) {
        continue
      }

      const result = new Lunisolar(candidate, config)
      const timestamp = result.valueOf()

      if (!results.some(item => item.valueOf() === timestamp)) {
        results.push(result)
      }
    }
  }

  results.sort((a, b) => a.valueOf() - b.valueOf())
  return results
}

/**
 * 更新全局配置
 */
lunisolar.config = (config: SettingGlobalConfig): typeof lunisolar => {
  if (!config) return lunisolar
  Object.assign(_GlobalConfig, config)
  return lunisolar
}

/**
 * 插件加载
 */
lunisolar.extend = <T = unknown>(plugin: PluginFunc<T>, options?: T): typeof lunisolar => {
  if (!plugin.$once) {
    plugin(options as T, Lunisolar, lunisolar)
    plugin.$once = true
  }
  return lunisolar
}

/**
 * 加载语言包
 */
lunisolar.locale = (
  localeData: LsrLocale | LsrLocale[],
  unChangeLang: boolean = false
): typeof lunisolar => {
  if (Array.isArray(localeData)) {
    for (const item of localeData) {
      lunisolar.locale(item, unChangeLang)
    }
    return lunisolar
  }
  if (!localeData || !localeData.name) return lunisolar
  _GlobalConfig.locales[localeData.name] = Object.assign(
    {},
    _GlobalConfig.locales[localeData.name],
    zh,
    localeData
  )
  if (!unChangeLang) _GlobalConfig.lang = localeData.name
  if (unChangeLang && _GlobalConfig.lang !== 'zh') {
    _GlobalConfig.locales[_GlobalConfig.lang] = Object.assign(
      {},
      _GlobalConfig.locales['zh'],
      _GlobalConfig.locales[_GlobalConfig.lang]
    )
  }

  return lunisolar
}

lunisolar.getLocale = (lang: string): LocaleData => {
  return _GlobalConfig.locales[lang]
}

lunisolar.defineLocale = defineLocale

lunisolar.Markers = Markers

lunisolar._globalConfig = _GlobalConfig

Object.defineProperty(lunisolar, '_globalConfig', {
  writable: false
})
