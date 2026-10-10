import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('Android and iOS native transports keep the same bounded envelope contract', async () => {
  const [android, ios] = await Promise.all([
    readFile(new URL('../android/app/src/main/java/com/arthur/mapparty/MapPartyLocalTransportModule.kt', import.meta.url), 'utf8'),
    readFile(new URL('../modules/map-party-local-transport/ios/MapPartyNearbyTransport.swift', import.meta.url), 'utf8')
  ]);
  for (const source of [android, ios]) {
    assert.match(source, /com\.arthur\.mapparty\.offline/);
    assert.match(source, /16\s*\*\s*1024/);
    assert.match(source, /messageId/);
    assert.match(source, /hops/);
  }
  assert.match(android, /MAX_TTL_MS\s*=\s*180_000/);
  assert.match(ios, /maxTTLSeconds:\s*TimeInterval\s*=\s*180/);
  assert.match(ios, /envelope\.count\s*<=\s*Self\.maxEnvelopeBytes/);
  assert.match(ios, /continuation\.resume\(returning: error == nil\)/);
});

test('iOS release build requires Nearby and asks users to verify peer codes', async () => {
  const [ios, workflow, nearbyPlugin, partyHook, siriIntents] = await Promise.all([
    readFile(new URL('../modules/map-party-local-transport/ios/MapPartyNearbyTransport.swift', import.meta.url), 'utf8'),
    readFile(new URL('../../.github/workflows/ios-unsigned-ipa.yml', import.meta.url), 'utf8'),
    readFile(new URL('../plugins/withNearbyConnections.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/hooks/useParty.js', import.meta.url), 'utf8'),
    readFile(new URL('../plugins/native/ios/MapPartySiriIntents.swift', import.meta.url), 'utf8')
  ]);
  assert.match(ios, /#if MAP_PARTY_REQUIRE_NEARBY[\s\S]*?#error\("NearbyConnections must be linked/);
  assert.match(workflow, /SWIFT_ACTIVE_COMPILATION_CONDITIONS=MAP_PARTY_REQUIRE_NEARBY/);
  assert.match(workflow, /npm test -w mobile/);
  assert.match(workflow, /Xcode 26\.4\.1 or newer is required/);
  assert.match(workflow, /Swift 6\.2 or newer is required/);
  assert.match(workflow, /Validate local CocoaPods specification/);
  assert.match(workflow, /prebuild-ios\.log/);
  assert.doesNotMatch(workflow, /Xcode_16\./);
  assert.match(nearbyPlugin, /aa71c5209b067b3238ff0462d479452f3eda9165/);
  assert.match(partyHook, /Compare este código nos dois aparelhos/);
  assert.match(partyHook, /verify\(false\)/);
  assert.match(partyHook, /verify\(true\)/);
  assert.match(siriIntents, /@AppShortcutsBuilder\s+static var appShortcuts: \[AppShortcut\]/);
});

test('iOS local transport links SPM modules into its CocoaPods target and isolates URLSession delegation', async () => {
  const [podspec, location, nearby, nearbyPlugin] = await Promise.all([
    readFile(new URL('../modules/map-party-local-transport/ios/MapPartyLocalTransport.podspec', import.meta.url), 'utf8'),
    readFile(new URL('../modules/map-party-local-transport/ios/MapPartyLocationModule.swift', import.meta.url), 'utf8'),
    readFile(new URL('../modules/map-party-local-transport/ios/MapPartyNearbyTransport.swift', import.meta.url), 'utf8'),
    readFile(new URL('../plugins/withNearbyConnections.js', import.meta.url), 'utf8')
  ]);
  assert.match(podspec, /SWIFT_COMPILATION_MODE/);
  assert.match(location, /MapPartyBackgroundUploadDelegate: NSObject, URLSessionTaskDelegate/);
  assert.match(location, /delegate: backgroundUploadDelegate/);
  assert.doesNotMatch(location, /extension MapPartyLocationModule: URLSessionTaskDelegate/);
  assert.match(nearbyPlugin, /withPodfile/);
  assert.match(nearbyPlugin, /transport_target = pods_project\.targets\.find \{ \|target\| target\.name == 'MapPartyLocalTransport' \}/);
  assert.match(nearbyPlugin, /XCRemoteSwiftPackageReference/);
  assert.match(nearbyPlugin, /transport_target\.package_product_dependencies/);
  assert.match(nearbyPlugin, /transport_target\.frameworks_build_phase\.files/);
  assert.match(nearbyPlugin, /\$\(OBJROOT\)\/NearbyConnections\.build\/\$\(CONFIGURATION\)\$\(EFFECTIVE_PLATFORM_NAME\)/);
  assert.match(nearby, /didReceive stream: InputStream[\s\S]*cancellationToken token: CancellationToken[\s\S]*stream\.close\(\); connectionManager\.disconnect\(from: endpointID\)/);
  assert.match(nearby, /didStartReceivingResourceWithID[\s\S]*connectionManager\.disconnect\(from: endpointID\)/);
});

test('native Android and iOS location producers expose authenticated recovery upload', async () => {
  const [android, ios] = await Promise.all([
    readFile(new URL('../android/app/src/main/java/com/arthur/mapparty/LocationForegroundService.kt', import.meta.url), 'utf8'),
    readFile(new URL('../modules/map-party-local-transport/ios/MapPartyLocationModule.swift', import.meta.url), 'utf8')
  ]);
  const secureAndroid = await readFile(new URL('../android/app/src/main/java/com/arthur/mapparty/SecureCredentialStore.kt', import.meta.url), 'utf8');
  for (const source of [android, ios]) {
    assert.match(source, /api\/party\/.*location/);
    assert.match(source, /Authorization/);
    assert.match(source, /locationSequence/);
    assert.match(source, /pending/);
  }
  assert.match(ios, /URLSessionConfiguration\.background/);
  assert.match(ios, /uploadTask\(with: request, from: pending\)/);
  assert.match(ios, /"lat": coordinate\.latitude/);
  assert.match(ios, /"lng": coordinate\.longitude/);
  assert.match(ios, /"latitude": coordinate\.latitude/);
  assert.match(ios, /"longitude": coordinate\.longitude/);
  const party = await readFile(new URL('../src/hooks/useParty.js', import.meta.url), 'utf8');
  assert.match(party, /requireOptionalNativeModule\('MapPartyLocation'\)/);
  assert.match(party, /locationModule\.configureBackgroundUpload/);
  assert.match(ios, /import Security/);
  assert.match(ios, /SecItemAdd/);
  assert.match(ios, /SecItemCopyMatching/);
  assert.doesNotMatch(ios, /defaults\.set\(options\["credential"\]/);
  assert.match(secureAndroid, /AndroidKeyStore/);
  assert.match(secureAndroid, /AES\/GCM\/NoPadding/);
  assert.match(secureAndroid, /credential_ciphertext/);
  assert.match(android, /uploadInFlight/);
  assert.match(android, /retryDelayMs/);
  assert.match(android, /postDelayed/);
});
