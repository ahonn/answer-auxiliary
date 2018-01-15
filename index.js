"use strict"

const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const jimp = require('jimp')
const keypress = require('keypress')
const cheerio = require('cheerio')
const jieba = require("nodejieba")
const exec = require('child-process-promise').exec
const OcrClient = require("baidu-aip-sdk").ocr
const puppeteer = require('puppeteer')

const OCR_OPTIONS = {
  "language_type": "CHN_ENG",
}

const BAIDU_ZHIDAO_URL = `https://zhidao.baidu.com/search?word=`

class AnswerAuxiliary {
  constructor() {
    this.timestamp = Date.now()
    this.config = null
    this.ocrClient = null
    this.puppeteer = null
  }

  async init() {
    // load config
    const configPath = path.join(__dirname, 'config.yml')
    this.config = yaml.safeLoad(fs.readFileSync(configPath, 'utf-8'))

    // init ocr client
    const { app_id, app_key, secret_key } = this.config.ocr
    this.ocrClient = new OcrClient(app_id, app_key, secret_key)

    // init puppeteer browser page
    const browser = await puppeteer.launch()
    const page = await browser.newPage()
    this.puppeteer = {
      browser,
      page
    }
  }

  async close() {
    try {
      await exec('rm screenshot-*')
    } catch (e) {}
    await this.puppeteer.browser.close()
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
   * crop image
   *
   * @param {string} screenshot screenshot path
   * @param {object} option crop option
   * @returns {string} image base64
   */
  async imageCrop(image, option) {
    image.crop(option.x, option.y, option.width, option.height)

    return new Promise((resolve) => {
      image.getBuffer(jimp.AUTO, (err, data) => {resolve(data)})
    })
  }

  /**
   * ocr image (Baidu Api)
   *
   * @param {object} image jimp imgae
   * @param {object} option region option(x, y, width, height)
   * @returns {string} ocr result
   */
  async ocrImage(image, option) {
    const region = await this.imageCrop(image, option)
    const base64Image = region.toString("base64")
    // const result = await this.ocrClient.accurateBasic(base64Image, OCR_OPTIONS)
    const result = await this.ocrClient.generalBasic(base64Image, OCR_OPTIONS)
    return result.words_result
  }

  /**
   * ocr question region
   *
   * @param {object} image jimp image
   * @returns {object} question(text, keyword)
   */
  async ocrQuestion(image) {
    const { question: questionOption } = this.config
    const questionRes = await this.ocrImage(image.clone(), questionOption)

    const text = questionRes.map(res => res.words).join('')
    // remove order number and special symbols
    const pureText = text.replace(/^\d+/, '')
                         .replace(/[《》]/g, '')

    const keyword = jieba.extract(pureText, 5)
    const question = {
      text,
      keyword,
    }
    return question
  }

  /**
   * ocr choices region
   *
   * @param {object} image jimp image
   * @returns {array} choice array
   */
  async ocrChoices(image) {
    const { choices: choicesOption } = this.config
    const choicesRes = await this.ocrImage(image.clone(), choicesOption)

    let choices = choicesRes.map(res => res.words)
    if (choices.length === 1) {
      choices = jieba.cut(choices[0])
    }
    return choices
  }

  /**
   * analyze choices by baidu zhidao
   *
   * @param {object} question
   * @param {array} choices
   * @returns {array} choice result array
   */
  async analyzeChoices(question, choices) {
    const search = question.keyword.map(res => res.word).join(' ')
    const url = BAIDU_ZHIDAO_URL + search

    await this.puppeteer.page.goto(url)
    const html = await this.puppeteer.page.content()
    // strip html and trailing white spaces
    const text = cheerio.load(html).text().replace(/^\s+|\s+$/gm, '')

    const result = choices.map(choice => {
      const matchRes = text.match(new RegExp(choice, 'g')) || []
      return {
        name: choice,
        count: matchRes.length
      }
    })
    return result
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
      console.log(`Question: ${question.text}`)

      const results = await this.analyzeChoices(question, choices)
      results.forEach(res => {
        console.log(`Choice: ${res.name} - ${res.count}`)
      })
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
      if (key && key.ctrl && key.name == 'c') {
        a.close().then(() => {
          process.stdin.pause()
          process.exit(0)
        })
      } else if (key && key.name == 'return') {
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

