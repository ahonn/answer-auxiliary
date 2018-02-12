/* eslint-disable no-console */
const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const jimp = require('jimp')
const keypress = require('keypress')
const cheerio = require('cheerio')
const jieba = require('nodejieba')
const {
  exec,
} = require('child-process-promise')
const OcrClient = require('baidu-aip-sdk').ocr
const puppeteer = require('puppeteer')

const OCR_OPTIONS = {
  language_type: 'CHN_ENG',
}

const SEARCH_URL = 'https://zhidao.baidu.com/search?word='
// const SEARCH_URL = 'https://www.baidu.com/s?wd='

class AnswerAuxiliary {
  constructor() {
    this.timestamp = Date.now()
    this.config = null
    this.ocrClient = null
    this.browser = null
  }

  async init() {
    // load config
    const configPath = path.join(__dirname, 'config.yml')
    this.config = yaml.safeLoad(fs.readFileSync(configPath, 'utf-8'))

    // init ocr client
    const {
      app_id,
      app_key,
      secret_key,
    } = this.config.ocr
    this.ocrClient = new OcrClient(app_id, app_key, secret_key)

    // init puppeteer browser page
    this.browser = await puppeteer.launch()
  }

  async close() {
    try {
      await exec('rm screenshot-*')
    } catch (e) {} // eslint-disable-line
    await this.browser.close()
  }

  /**
   * screencap android device
   *
   * @returns {string} screenshot path
   */
  async screencap() {
    const screenshotName = `screenshot-${this.timestamp}.png`
    const screenshotPath = path.join(__dirname, screenshotName)

    await exec(`adb shell screencap -p > ${screenshotPath}`)
    return screenshotPath
  }

  /**
   * ocr image (Baidu Api)
   *
   * @param {object} image jimp imgae
   * @param {object} option region option(x, y, width, height)
   * @returns {string} ocr result
   */
  async ocrImage(image, option) {
    image.crop(option.x, option.y, option.width, option.height)

    const region = await new Promise((resolve) => {
      image.getBuffer(jimp.AUTO, (err, data) => {
        resolve(data)
      })
    })

    const base64Image = region.toString('base64')
    // const result = await this.ocrClient.accurateBasic(base64Image, OCR_OPTIONS)
    const result = await this.ocrClient.generalBasic(base64Image, OCR_OPTIONS)
    if (result.error_code) {
      console.error(result.error_msg)
      process.exit(0)
    }
    return result.words_result
  }

  /**
   * ocr question region
   *
   * @param {object} image jimp image
   * @returns {object} question(text, keyword)
   */
  async ocrQuestion(image) {
    const {
      question: questionOption,
    } = this.config
    const questionRes = await this.ocrImage(image.clone(), questionOption)

    const question = questionRes.map(res => res.words).join('')
    return question
  }

  /**
   * ocr choices region
   *
   * @param {object} image jimp image
   * @returns {array} choice array
   */
  async ocrChoices(image) {
    const {
      choices: choicesOption,
    } = this.config
    const choicesRes = await this.ocrImage(image.clone(), choicesOption)

    let choices = choicesRes.map(res => res.words)
    if (choices.length === 1) {
      choices = jieba.cut(choices[0])
    }
    return choices
  }

  /**
   * search
   *
   * @param {string} url search url
   * @param {string} [query=''] query string
   * @returns {string}
   */
  async search(url, query = '') {
    const page = await this.browser.newPage()
    await page.goto(url + query)
    const html = await page.content()
    // strip html and trailing white spaces
    const text = cheerio.load(html).text().replace(/^\s+|\s+$/gm, '')
    return text
  }

  /**
   * analyze choices by baidu zhidao
   *
   * @param {object} question
   * @param {array} choices
   * @returns {array} choice result array
   */
  async analyzeChoices(question, choices) {
    const url = SEARCH_URL + question

    const res = await Promise.all([
      this.search(url),
      this.search(url, '&pn=10'),
    ]).then(([text1, text2]) => {
      const text = text1 + text2

      const result = choices.map(choice => {
        const matchRes = text.match(new RegExp(choice, 'g')) || []
        return {
          name: choice,
          count: matchRes.length,
        }
      })

      return result
    })

    return res
  }

  /**
   * run script
   *
   * @returns {undefined}
   */
  async run() {
    const screenshot = await this.screencap()
    const image = await jimp.read(screenshot)

    await Promise.all([
      this.ocrQuestion(image.clone()),
      this.ocrChoices(image.clone()),
    ]).then(async ([question, choices]) => {
      console.log(`Question: ${question.yellow}`)

      const results = await this.analyzeChoices(question, choices)
      results.forEach((res) => {
        console.log(`Choice: ${res.name} - ${res.count}`)
      })

      const sortResult = results.sort((a, b) => a.count < b.count)
      const mostAnswer = sortResult[0]
      const lessAnswer = sortResult[sortResult.length - 1]
      console.log(`Answer: ${mostAnswer.name.cyan} ${lessAnswer.name.red}`)
    })
  }
}

const a = new AnswerAuxiliary()
a.init()
  .then(async () => {
    // first time screencap will slow
    a.screencap()
  })
  .then(() => {
    keypress(process.stdin)
    console.log('[INFO]: Starting success..')
    console.log('[HELP]: Press enter key to run...')

    process.stdin.on('keypress', (ch, key) => {
      if (key && key.ctrl && key.name === 'c') {
        a.close().then(() => {
          process.stdin.pause()
          process.exit(0)
        })
      } else if (key && key.name === 'return') {
        console.time('[TIME]')
        console.log('\n[INFO]: Running...')

        a.run().then(() => {
          console.timeEnd('[TIME]')
        })
      }
    })

    process.stdin.setRawMode(true)
    process.stdin.resume()
  })
