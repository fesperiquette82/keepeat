import * as ImagePicker from 'expo-image-picker';
import { logger } from './logger';

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

export async function pickImageFromGallery(options: PickImageOptions = {}): Promise<PickImageResult> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission?.granted) return { status: 'permission_denied' };

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
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
  } catch (error) {
    logger.errorFromException('Gallery picker failed', error);
    return { status: 'unavailable' };
  }
}

export type GalleryAlertMessages = {
  permissionDenied: string;
  unavailable: string;
  invalidImage: string;
};

export function getGalleryErrorMessage(
  result: PickImageResult,
  messages: GalleryAlertMessages,
): string | null {
  if (result.status === 'permission_denied') return messages.permissionDenied;
  if (result.status === 'unavailable') return messages.unavailable;
  if (result.status === 'invalid_image') return messages.invalidImage;
  return null;
}
