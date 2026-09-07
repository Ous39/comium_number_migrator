/** Visual tokens for the built-in screen. Override any subset via configureGNM({ theme }). */
export interface GnmTheme {
  primary: string; // brand accent — buttons, active states
  primaryText: string; // text/icon colour on top of `primary`
  bg: string; // screen background
  card: string; // surfaces / rows
  text: string; // primary text
  subtext: string; // secondary text
  border: string; // hairlines
  track: string; // progress-bar track
  success: string;
  warning: string;
  danger: string;
  radius: number; // corner radius for cards/buttons
}

/** Comium house style — red wordmark, near-black text, light-grey ground. */
export const COMIUM_THEME: GnmTheme = {
  primary: '#E1251B',
  primaryText: '#FFFFFF',
  bg: '#F6F6F7',
  card: '#FFFFFF',
  text: '#111921',
  subtext: '#5B6570',
  border: '#E6E7EA',
  track: '#EDEDEF',
  success: '#0A7D52',
  warning: '#B06F14',
  danger: '#BF3B2B',
  radius: 14,
};
