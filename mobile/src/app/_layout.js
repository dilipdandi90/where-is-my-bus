import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useState } from 'react'
import { View } from 'react-native'
import Intro from '../components/Intro.js'

// The launch screen fades straight into the animated intro, which starts from the same picture.
SplashScreen.setOptions({ duration: 200, fade: true })

export default function RootLayout() {
  // Only once per launch: this layout stays mounted while moving between screens.
  const [intro, setIntro] = useState(true)
  const done = useCallback(() => setIntro(false), [])

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
      {intro && <Intro onDone={done} />}
    </View>
  )
}
