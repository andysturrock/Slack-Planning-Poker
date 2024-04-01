import 'source-map-support/register';
import {refreshToken} from './slackAPI';

/**
 * Simply calls the refresh token function.  Called by a timer.
 */
export async function rotateSlackRefreshToken(): Promise<void> {
  try {
    await refreshToken();
  }
  catch (error) {
    console.error(error);
  }
}