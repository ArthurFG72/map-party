const { withXcodeProject } = require('@expo/config-plugins');

const REPOSITORY = 'https://github.com/google/nearby';
const REVISION = 'aa71c5209b067b3238ff0462d479452f3eda9165';
const PRODUCT = 'NearbyConnections';

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
  return withXcodeProject(config, config => {
    ensurePackage(config.modResults);
    return config;
  });
};
