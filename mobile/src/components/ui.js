import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { colors } from '../lib/theme.js'

const BUS_PATH =
  'M5 4a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v14a2 2 0 0 1-1 1.73V21a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H9v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-1.27A2 2 0 0 1 5 18V4Zm2 2v6h10V6H7Zm1.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm7 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'
// Material Icons "train" (Apache 2.0), as on the website.
const TRAIN_PATH =
  'M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z'
const BELL_PATH = 'M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z'
const SEARCH_PATH = 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16a6.47 6.47 0 0 0 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z'
const SWAP_PATH = 'M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3ZM9 3 5 6.99h3V14h2V6.99h3L9 3Z'

function Icon({ d, size = 20, color = colors.ink }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={d} fill={color} />
    </Svg>
  )
}

export const BusIcon = (p) => <Icon d={BUS_PATH} {...p} />
export const TrainIcon = (p) => <Icon d={TRAIN_PATH} {...p} />
export const BellIcon = (p) => <Icon d={BELL_PATH} {...p} />
export const SearchIcon = (p) => <Icon d={SEARCH_PATH} {...p} />
export const SwapIcon = (p) => <Icon d={SWAP_PATH} {...p} />

/** A bus number, or for a metro line "Line 1" in the line's colour. */
export function ServicePlate({ metro, service, large = false }) {
  const bg = metro && service.color ? `#${service.color}` : colors.road
  const fg = metro && service.color ? `#${service.textColor || 'FFFFFF'}` : colors.ink
  return (
    <View style={[styles.plate, { backgroundColor: bg }]}>
      <Text style={[styles.plateText, { color: fg, fontSize: large ? 22 : 15 }]} numberOfLines={2}>
        {metro ? `Line ${service.number}` : service.number}
      </Text>
    </View>
  )
}

export function PlatformChip({ platform }) {
  if (!platform) return null
  return (
    <View style={styles.pf}>
      <Text style={styles.pfText}>PF {platform}</Text>
    </View>
  )
}

export function Message({ title, children }) {
  return (
    <View style={styles.message}>
      <Text style={styles.messageTitle}>{title}</Text>
      {children ? <Text style={styles.messageBody}>{children}</Text> : null}
    </View>
  )
}

export function ErrorMessage({ title, error, onRetry }) {
  return (
    <View style={styles.message}>
      <Text style={styles.messageTitle}>{title}</Text>
      {error?.message ? <Text style={styles.messageBody}>{error.message}</Text> : null}
      {onRetry ? <Button title="Try again" onPress={onRetry} style={{ marginTop: 12, alignSelf: 'center' }} /> : null}
    </View>
  )
}

/** Shrinks slightly while pressed, like the website's buttons. */
export function Press({ style, children, ...props }) {
  return (
    <Pressable {...props} style={({ pressed }) => [typeof style === 'function' ? style({ pressed }) : style, pressed && { transform: [{ scale: 0.97 }] }]}>
      {children}
    </Pressable>
  )
}

export function Button({ title, onPress, disabled, kind = 'dark', style }) {
  const dark = kind === 'dark'
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[styles.button, dark ? { backgroundColor: colors.ink } : { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line }, disabled && { opacity: 0.4 }, style]}
    >
      <Text style={[styles.buttonText, { color: dark ? colors.paper : colors.ink }]}>{title}</Text>
    </Press>
  )
}

/** A two-way switch such as Bus | Metro or Stops | Map. */
export function Segmented({ options, value, onChange, dark = false }) {
  return (
    <View style={[styles.segmented, { backgroundColor: dark ? 'rgba(242,245,251,0.1)' : 'rgba(223,229,240,0.7)' }]} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value
        return (
          <Press
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            disabled={o.disabled}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.segment, selected && styles.segmentOn, o.disabled && { opacity: 0.4 }]}
          >
            {o.icon ? o.icon(selected ? colors.ink : dark ? 'rgba(242,245,251,0.8)' : colors.inkSoft) : null}
            <Text style={[styles.segmentText, { color: selected ? colors.ink : dark ? 'rgba(242,245,251,0.8)' : colors.inkSoft }]}>{o.label}</Text>
          </Press>
        )
      })}
    </View>
  )
}

export const styles = StyleSheet.create({
  plate: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 2, alignSelf: 'flex-start', maxWidth: '55%' },
  plateText: { fontWeight: '900', letterSpacing: -0.3 },
  pf: { marginLeft: 6, borderWidth: 1, borderColor: 'rgba(86,96,121,0.4)', borderRadius: 4, paddingHorizontal: 4 },
  pfText: { fontSize: 10, fontWeight: '700', color: colors.inkSoft },
  message: { paddingHorizontal: 20, paddingVertical: 40, alignItems: 'center' },
  messageTitle: { fontWeight: '600', fontSize: 16, color: colors.ink, textAlign: 'center' },
  messageBody: { marginTop: 4, fontSize: 14, color: colors.inkSoft, textAlign: 'center' },
  button: { borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center' },
  buttonText: { fontWeight: '600', fontSize: 16 },
  segmented: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4 },
  segment: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 10 },
  segmentOn: { backgroundColor: colors.card, elevation: 1 },
  segmentText: { fontWeight: '700', fontSize: 14 },
})
