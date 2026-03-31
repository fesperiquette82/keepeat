type PickerStatus = 'success' | 'cancelled' | 'permission_denied' | 'unavailable' | 'invalid_image';

export type PickedGalleryAsset = {
  uri: string;
  base64?: string | null;
  width?: number;
  height?: number;
};

export type PickImageResult =
  | { status: Exclude<PickerStatus, 'success'> }
  | { status: 'success'; asset: PickedGalleryAsset };

type PickImageOptions = {
  includeBase64?: boolean;
  quality?: number;
};

/**
 * Wrapper isolant l'accès à expo-image-picker.
 * Permet de garder le build robuste même si le module n'est pas encore installé localement.
 */
export async function pickImageFromGallery(options: PickImageOptions = {}): Promise<PickImageResult> {
  let ImagePicker: any;
  try {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    ImagePicker = require('expo-image-picker');
  } catch {
    return { status: 'unavailable' };
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission?.granted) return { status: 'permission_denied' };

  const pickerResult = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: false,
    quality: options.quality ?? 0.7,
    base64: Boolean(options.includeBase64),
  });

  if (pickerResult?.canceled) return { status: 'cancelled' };

  const asset = pickerResult?.assets?.[0];
  if (!asset?.uri) return { status: 'invalid_image' };

  return {
    status: 'success',
    asset: {
      uri: asset.uri,
      base64: asset.base64,
      width: asset.width,
      height: asset.height,
    },
  };
}
