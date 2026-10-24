// The files a PDF embeds: the Inter font (OFL-1.1, static TTF from Google Fonts via @expo-google-fonts/inter) and an
// sRGB ICC profile (CC0, Compact ICC Profiles, see assets/README.md). They are bundled into the build as data: URLs,
// because the app makes no requests under file:// (connect-src 'none'), and decoded here.
import interRegular from '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf?inline';
import interSemiBold from '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf?inline';
import srgbProfile from './assets/sRGB-v2-magic.icc?inline';

/** The bytes of a base64 data: URL */
function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface PdfAssets {
  regular: Uint8Array;
  semiBold: Uint8Array;
  /** sRGB profile for the output intent */
  srgb: Uint8Array;
}

let decoded: PdfAssets | null = null;

/** Decoded once, when the first PDF is made */
export const pdfAssets = (): PdfAssets => (decoded ??= { regular: bytesOf(interRegular), semiBold: bytesOf(interSemiBold), srgb: bytesOf(srgbProfile) });
