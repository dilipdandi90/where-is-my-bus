// The app shares its tracking and timetable logic with the website, in ../src/lib, so a fix there
// reaches both. Metro is told to look there too. See https://docs.expo.dev/guides/monorepos/
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '../src/lib')]

module.exports = config
