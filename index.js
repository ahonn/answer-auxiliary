"use strict"

const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const jimp = require('jimp')
const open = require('open')
const nodejieba = require('nodejieba')
const request = require('request-promise')
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

  loadConfig() {
    const configPath = path.join(__dirname, 'config.yml')
    const config = yaml.safeLoad(fs.readFileSync(configPath, 'utf-8'))
    return config
  }

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
    // const image = await jimp.read(screenshot)
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
    return result.words_result.map(res => res.words).join('').replace(/^\d+/, '')
  }

  async ocrQuestion(image) {
    const { question: questionOption } = this.config

    const questionImage = await this.imageCrop(image, questionOption)
    const questionStr = await this.ocr(questionImage)
    const question = nodejieba.extract(questionStr, 4).map(res => res.word)
    return question
  }

  // async ocrChoices(image) {
    // const { choice: choiceOption } = this.config
    // const choiceImage = await this.imageCrop(image, choiceOption)
    // const choices = await this.ocr(choiceImage)
    // return choices
  // }

  async run() {
    console.time('run')

    const screenshot = await this.screencap()
    const image = await jimp.read(screenshot)

    await Promise.all([
      this.ocrQuestion(image.clone()),
      // this.ocrChoices(image.clone()),
    ]).then(async ([question/*, choices*/]) => {
      // const html = await request(BAIDU_ZHIDAO_URL + question.join('%20'))
      // console.log(html)
      
      open(BAIDU_ZHIDAO_URL + question.join(' '))
    })

    await this.removeScreenshot(screenshot)

    console.timeEnd('run')
  }
}

const c = new ChongdingHelper()
c.run()

