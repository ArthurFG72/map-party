const { withPodfile, withXcodeProject } = require('@expo/config-plugins');

const REPOSITORY = 'https://github.com/google/nearby';
const REVISION = 'aa71c5209b067b3238ff0462d479452f3eda9165';
const PRODUCT = 'NearbyConnections';
const PODFILE_MARKER = '# @generated begin map-party-nearby-swift-module-path';

function ensurePodfile(contents) {
  if (contents.includes(PODFILE_MARKER)) return contents;
  const postInstallEnd = /\r?\n  end\r?\nend\s*$/;
  const match = contents.match(postInstallEnd);
  if (!match) throw new Error('CocoaPods post_install block not found while linking Nearby Connections.');

  const hook = `
    ${PODFILE_MARKER}
    installer.pods_project.targets.each do |target|
      next unless target.name == 'MapPartyLocalTransport'
      target.build_configurations.each do |configuration|
        configured_paths = configuration.build_settings['SWIFT_INCLUDE_PATHS']
        paths = configured_paths.is_a?(Array) ? configured_paths : configured_paths.to_s.split(/\\s+/)
        paths << '$(BUILT_PRODUCTS_DIR)' unless paths.include?('$(BUILT_PRODUCTS_DIR)')
        configuration.build_settings['SWIFT_INCLUDE_PATHS'] = paths
      end
    end
    # @generated end map-party-nearby-swift-module-path
`;
  return contents.replace(postInstallEnd, `${hook}${match[0]}`);
}

function findByComment(section, name) {
  for (const key of Object.keys(section || {})) {
    if (!key.endsWith('_comment') && section[`${key}_comment`] === name) return key;
  }
  return null;
}

function ensurePackage(project) {
  const objects = project.hash.project.objects;
  const projectSection = objects.PBXProject;
  const firstProject = project.getFirstProject();
  const projectUuid = firstProject.uuid;
  const firstTarget = project.getFirstTarget();
  const target = firstTarget?.firstTarget;
  if (!target) throw new Error('Map Party iOS target not found while adding Nearby Connections.');

  objects.XCRemoteSwiftPackageReference ||= {};
  objects.XCSwiftPackageProductDependency ||= {};
  const existingPackage = findByComment(objects.XCRemoteSwiftPackageReference, 'XCRemoteSwiftPackageReference "nearby"');
  const packageUuid = existingPackage || project.generateUuid();
  if (!existingPackage) {
    objects.XCRemoteSwiftPackageReference[packageUuid] = {
      isa: 'XCRemoteSwiftPackageReference',
      repositoryURL: REPOSITORY,
      requirement: { kind: 'revision', revision: REVISION }
    };
    objects.XCRemoteSwiftPackageReference[`${packageUuid}_comment`] = 'XCRemoteSwiftPackageReference "nearby"';
  }

  const productComment = `XCSwiftPackageProductDependency ${PRODUCT}`;
  const existingProduct = findByComment(objects.XCSwiftPackageProductDependency, productComment);
  const productUuid = existingProduct || project.generateUuid();
  if (!existingProduct) {
    objects.XCSwiftPackageProductDependency[productUuid] = {
      isa: 'XCSwiftPackageProductDependency',
      package: packageUuid,
      productName: PRODUCT
    };
    objects.XCSwiftPackageProductDependency[`${productUuid}_comment`] = productComment;
  }

  const root = projectSection[projectUuid];
  root.packageReferences ||= [];
  if (!root.packageReferences.some(item => item.value === packageUuid)) {
    root.packageReferences.push({ value: packageUuid, comment: `XCRemoteSwiftPackageReference "nearby"` });
  }
  target.packageProductDependencies ||= [];
  if (!target.packageProductDependencies.some(item => item.value === productUuid)) {
    target.packageProductDependencies.push({ value: productUuid, comment: productComment });
  }
}

module.exports = function withNearbyConnections(config) {
  config = withXcodeProject(config, config => {
    ensurePackage(config.modResults);
    return config;
  });
  return withPodfile(config, config => {
    config.modResults.contents = ensurePodfile(config.modResults.contents);
    return config;
  });
};

module.exports.ensurePodfile = ensurePodfile;
