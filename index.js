"use strict"

const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const jimp = require('jimp')
const open = require('open')
const keypress = require('keypress')
const exec = require('child-process-promise').exec
const OcrClient = require("baidu-aip-sdk").ocr

const OCR_OPTIONS = {
  "language_type": "CHN_ENG",
}

const BAIDU_ZHIDAO_URL = `https://zhidao.baidu.com/search?word=`

class ChongdingHelper {
  constructor() {
    this.timestamp = Date.now()
    this.config = this.loadConfig()
    this.ocrClient = this.loadOcrClient()
  }

  /**
   * load config file (question position & baidu api key)
   *
   * @returns {object} config
   */
  loadConfig() {
    const configPath = path.join(__dirname, 'config.yml')
    const config = yaml.safeLoad(fs.readFileSync(configPath, 'utf-8'))
    return config
  }

  /**
   * load baidu ocr client
   *
   * @returns {object} ocr client
   */
  loadOcrClient() {
    const { app_id, app_key, secret_key } = this.config.ocr
    const ocrClient = new OcrClient(app_id, app_key, secret_key)
    return ocrClient
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
   * remove screenshot
   *
   * @param {string} path screenshot path
   * @returns {undefined}
   */
  async removeScreenshot(path) {
    await exec(`rm ${path}`)
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
    return result.words_result.map(res => res.words).join('')
  }

  /**
   * ocr question
   *
   * @param {object} image jimp imgae object
   * @returns {string} question string
   */
  async ocrQuestion(image) {
    const { question: questionOption } = this.config

    const questionImage = await this.imageCrop(image, questionOption)
    const question = await this.ocr(questionImage)
    return question
  }

  /**
   * run script
   *
   * @returns {undefined}
   */
  async run() {
    console.time('screenshot')
    const screenshot = await this.screencap()

    console.timeEnd('screenshot')
    const image = await jimp.read(screenshot)

    console.time('ocr')
    const question = await this.ocrQuestion(image)
    console.timeEnd('ocr')
    // open(BAIDU_ZHIDAO_URL + question)

    await this.removeScreenshot(screenshot)
    return question
  }
}

const c = new ChongdingHelper()
c.screencap()
  .then((path) => c.removeScreenshot(path))
  .then(() => {
    keypress(process.stdin)
    console.log('[INFO]: Starting success..')
    console.log('[HELP]: Press any key to run...')

    process.stdin.on('keypress', (ch, key) => {
      if (key && key.ctrl && key.name == 'c') {
        process.stdin.pause()
      } else {
        console.time('[TIME]')
        c.run().then(question => {
          console.log(`[INFO]: Question: ${question}`)
          console.timeEnd('[TIME]')
        })
      }
    })

    process.stdin.setRawMode(true)
    process.stdin.resume()
  })


