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

const BAIDU_ZHIDAO_URL = `https://www.baidu.com/s?wd=site:zhidao.baidu.com `

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

    await exec(`adb shell screencap -p /sdcard/${screenshotName}`)
    await exec(`adb pull /sdcard/${screenshotName} ${__dirname}`)
    await exec(`adb shell rm /sdcard/${screenshotName}`)
    return path.join(__dirname, screenshotName)
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
    const result = await this.ocrClient.generalBasic(base64Image, OCR_OPTIONS)
    return result.words_result.map(res => res.words).join('').replace(/^\d+./, '')
  }

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
    console.time('[TIME]')

    const screenshot = await this.screencap()
    const image = await jimp.read(screenshot)

    const question = await this.ocrQuestion(image)
    open(BAIDU_ZHIDAO_URL + question)

    await this.removeScreenshot(screenshot)

    console.timeEnd('[TIME]')
    return question
  }
}

keypress(process.stdin)
const c = new ChongdingHelper()
console.log('[INFO]: Starting success..')
console.log('[HELP]: Press any key to run...')

process.stdin.on('keypress', (ch, key) => {
  if (key && key.ctrl && key.name == 'c') {
    process.stdin.pause()
  } else {
    c.run().then(question => {
      console.log(`[INFO]: Question: ${question}`)
    })
  }
})
 
process.stdin.setRawMode(true)
process.stdin.resume()


