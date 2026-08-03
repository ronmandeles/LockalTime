/**
 * @format
 */

// Must come first: replaces React Native's built-in URL (whose `protocol` is a
// getter with no setter) with a spec-compliant one. @supabase/supabase-js
// assigns to `url.protocol` when deriving its realtime endpoint, so without
// this the very first createClient() call throws and the app never renders.
import 'react-native-url-polyfill/auto';

import { AppRegistry } from 'react-native';

import { name as appName } from './app.json';
import App from './src/App';

AppRegistry.registerComponent(appName, () => App);
