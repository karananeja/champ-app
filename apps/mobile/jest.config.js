/** Jest (F09): jest-expo preset; pnpm keeps packages under node_modules/.pnpm, so the ignore pattern allows that. */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/src/test/setup.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg|@maplibre/.*))',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
};
