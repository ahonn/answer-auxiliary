"use strict"

const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const jimp = require('jimp')
const keypress = require('keypress')
const cheerio = require('cheerio')
const exec = require('child-process-promise').exec
const OcrClient = require("baidu-aip-sdk").ocr
const puppeteer = require('puppeteer')

const OCR_OPTIONS = {
  "language_type": "CHN_ENG",
}

const BAIDU_ZHIDAO_URL = `https://zhidao.baidu.com/search?word=`

class ChongdingHelper {
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
   * @param {buffer} image ocr image buffer
   * @returns {string} ocr result
   */
  async ocr(image) {
    const base64Image = image.toString("base64")
    // const result = await this.ocrClient.accurateBasic(base64Image, OCR_OPTIONS)
    const result = await this.ocrClient.generalBasic(base64Image, OCR_OPTIONS)
    return result.words_result
  }

  /**
   * ocr Image
   *
   * @param {object} image jimp imgae
   * @param {object} option region option(x, y, width, height)
   * @returns {string} question string
   */
  async ocrImage(image, option) {
    const region = await this.imageCrop(image, option)
    const result = await this.ocr(region)
    return result
  }

  async analyzeChoices(question, choices) {
    const url = BAIDU_ZHIDAO_URL + question
    await this.puppeteer.page.goto(url)
    const html = await this.puppeteer.page.content()
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

    const ocrQuestion = async () => {
      const { question: questionOption } = this.config
      const questionRes = await this.ocrImage(image.clone(), questionOption)
      const question = questionRes.map(res => res.words).join('')
      return question
    }

    const ocrChoices = async () => {
      const { choices: choicesOption } = this.config
      const choicesRes = await this.ocrImage(image.clone(), choicesOption)
      const choices = choicesRes.map(res => res.words)
      return choices
    }

    await Promise.all([
      ocrQuestion(),
      ocrChoices()
    ]).then(async ([question, choices]) => {
      console.log(`Question: ${question}`)

      const results = await this.analyzeChoices(question, choices)
      results.forEach(res => {
        console.log(`Choice: ${res.name} - ${res.count}`)
      })

      const answer = (results.sort((a, b) => a.count < b.count))[0]
      console.log(`Answer: 『${answer.name}』`)
    })
  }
}

const c = new ChongdingHelper()
c.init()
  .then(async () => {
    // first time screencap will slow
    c.screencap()
  })
  .then(() => {
    keypress(process.stdin)
    console.log('[INFO]: Starting success..')
    console.log('[HELP]: Press enter key to run...')

    process.stdin.on('keypress', (ch, key) => {
      if (key && key.ctrl && key.name == 'c') {
        c.close().then(() => {
          process.stdin.pause()
          process.exit(0)
        })
      } else if (key && key.name == 'return') {
        console.time('[TIME]')
        console.log('\n[INFO]: Running...')

        c.run().then(() => {
          console.timeEnd('[TIME]')
        })
      }
    })

    process.stdin.setRawMode(true)
    process.stdin.resume()
  })



