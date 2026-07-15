// Note: expo-local-authentication must be installed to use this module
// Run: npx expo install expo-local-authentication
import * as LocalAuthentication from 'expo-local-authentication';

export async function checkBiometricsSupport(): Promise<{
  supported: boolean;
  type: string;
}> {
  const compatible = await LocalAuthentication.hasHardwareAsync();
  if (!compatible) return { supported: false, type: 'None' };
  
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  if (!enrolled) return { supported: false, type: 'None' };
  
  const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
  let typeName = 'Biometrics';
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    typeName = 'Face ID';
  } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    typeName = 'Touch ID';
  } else if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) {
    typeName = 'Iris Scan';
  }
  
  return { supported: true, type: typeName };
}

export async function authenticateUser(promptMessage: string = 'Unlock Penny Budget'): Promise<boolean> {
  try {
    const support = await checkBiometricsSupport();
    if (!support.supported) {
      // If no biometrics exist, we fallback to true (unlocked)
      return true;
    }
    
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
      cancelLabel: 'Cancel',
    });
    
    return result.success;
  } catch (error) {
    console.error('Authentication error:', error);
    return false;
  }
}
