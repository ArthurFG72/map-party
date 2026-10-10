const { withPodfile } = require('@expo/config-plugins');

const REPOSITORY = 'https://github.com/google/nearby';
const REVISION = 'aa71c5209b067b3238ff0462d479452f3eda9165';
const PRODUCT = 'NearbyConnections';
const MODULE_SEARCH_PATH = '$(OBJROOT)/NearbyConnections.build/$(CONFIGURATION)$(EFFECTIVE_PLATFORM_NAME)/NearbyConnections.build/Objects-normal/$(CURRENT_ARCH)';
const PODFILE_MARKER = '# @generated begin map-party-nearby-pod-link';

function ensurePodfile(contents) {
  if (contents.includes(PODFILE_MARKER)) return contents;
  const postInstallEnd = /\r?\n  end\r?\nend\s*$/;
  const match = contents.match(postInstallEnd);
  if (!match) throw new Error('CocoaPods post_install block not found while linking Nearby Connections.');

  const hook = `
    ${PODFILE_MARKER}
    pods_project = installer.pods_project
    transport_target = pods_project.targets.find { |target| target.name == 'MapPartyLocalTransport' }
    raise 'MapPartyLocalTransport CocoaPods target not found while linking Nearby Connections.' unless transport_target

    package = pods_project.root_object.package_references.find { |reference| reference.repositoryURL == '${REPOSITORY}' }
    unless package
      package = pods_project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
      package.repositoryURL = '${REPOSITORY}'
      package.requirement = { 'kind' => 'revision', 'revision' => '${REVISION}' }
      pods_project.root_object.package_references << package
    end

    unless transport_target.package_product_dependencies.any? { |dependency| dependency.product_name == '${PRODUCT}' }
      product = pods_project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
      product.package = package
      product.product_name = '${PRODUCT}'
      transport_target.package_product_dependencies << product
      build_file = pods_project.new(Xcodeproj::Project::Object::PBXBuildFile)
      build_file.product_ref = product
      transport_target.frameworks_build_phase.files << build_file
    end
    transport_target.build_configurations.each do |configuration|
      paths = configuration.build_settings['SWIFT_INCLUDE_PATHS']
      paths = paths.is_a?(Array) ? paths : paths.to_s.split(/\\s+/)
      paths << '${MODULE_SEARCH_PATH}' unless paths.include?('${MODULE_SEARCH_PATH}')
      configuration.build_settings['SWIFT_INCLUDE_PATHS'] = paths
    end
    pods_project.save
    # @generated end map-party-nearby-pod-link
`;
  return contents.replace(postInstallEnd, `${hook}${match[0]}`);
}

module.exports = function withNearbyConnections(config) {
  return withPodfile(config, config => {
    config.modResults.contents = ensurePodfile(config.modResults.contents);
    return config;
  });
};

module.exports.ensurePodfile = ensurePodfile;
