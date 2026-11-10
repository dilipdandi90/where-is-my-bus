import { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { colors } from '../lib/theme.js'
import { BusIcon } from './ui.js'

const BUS_SIZE = 96

/**
 * Plays once when the app opens: the bus from the launch screen (same size, colour and place, so the
 * handover is seamless) shakes like an idling engine as a road draws out under it, the name fades up,
 * then the bus drives off and the intro fades into the home screen. About two seconds; shorter, with
 * no movement, when the phone asks for reduced motion.
 */
export default function Intro({ onDone }) {
  const { width } = useWindowDimensions()
  const [anim] = useState(() => ({
    road: new Animated.Value(0),
    idle: new Animated.Value(0),
    title: new Animated.Value(0),
    drive: new Animated.Value(0),
    fade: new Animated.Value(1),
  }))

  useEffect(() => {
    let stopped = false
    const finish = () => !stopped && onDone()
    const timing = (value, toValue, duration, easing = Easing.out(Easing.cubic)) => Animated.timing(value, { toValue, duration, easing, useNativeDriver: true })

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (stopped) return
      if (reduced) {
        anim.road.setValue(1)
        anim.title.setValue(1)
        Animated.sequence([Animated.delay(700), timing(anim.fade, 0, 250)]).start(finish)
        return
      }
      const shake = Animated.loop(
        Animated.sequence([timing(anim.idle, 1, 90, Easing.linear), timing(anim.idle, -1, 90, Easing.linear), timing(anim.idle, 0, 90, Easing.linear)]),
        { iterations: 3 },
      )
      Animated.sequence([
        Animated.parallel([shake, timing(anim.road, 1, 600)]),
        timing(anim.title, 1, 450),
        Animated.delay(500),
        // Drives off to the right as the intro fades into the home screen.
        Animated.parallel([timing(anim.drive, 1, 550, Easing.in(Easing.cubic)), Animated.sequence([Animated.delay(200), timing(anim.fade, 0, 350)])]),
      ]).start(finish)
    })
    return () => {
      stopped = true
    }
  }, [anim, onDone])

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.screen, { opacity: anim.fade }]} pointerEvents="none" accessibilityLabel="Where Is My Bus">
      <View style={{ alignItems: 'center', justifyContent: 'center', height: BUS_SIZE }}>
        <Animated.View
          style={{
            transform: [
              { translateX: Animated.add(anim.idle.interpolate({ inputRange: [-1, 1], outputRange: [-2, 2] }), anim.drive.interpolate({ inputRange: [0, 1], outputRange: [0, width] })) },
              { translateY: anim.idle.interpolate({ inputRange: [-1, 0, 1], outputRange: [1, 0, -1] }) },
            ],
          }}
        >
          <BusIcon size={BUS_SIZE} color={colors.road} />
        </Animated.View>
      </View>
      <Animated.View style={[styles.road, { transform: [{ scaleX: anim.road }] }]}>
        <View style={styles.dashes}>
          {Array.from({ length: 9 }, (_, i) => (
            <View key={i} style={styles.dash} />
          ))}
        </View>
      </Animated.View>
      <Animated.View
        style={{
          alignItems: 'center',
          opacity: anim.title,
          transform: [{ translateY: anim.title.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        }}
      >
        <Text style={styles.title}>Where Is My Bus</Text>
        <Text style={styles.tagline}>Live bus and metro tracking</Text>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.header, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  road: { width: 220, height: 6, borderRadius: 3, marginTop: 6, backgroundColor: 'rgba(242,245,251,0.18)', justifyContent: 'center', overflow: 'hidden' },
  dashes: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  dash: { width: 12, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,138,43,0.8)' },
  title: { marginTop: 22, color: colors.paper, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { marginTop: 4, color: 'rgba(242,245,251,0.7)', fontSize: 14 },
})
