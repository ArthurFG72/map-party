require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MapPartyLocalTransport'
  s.version        = package['version']
  s.summary        = 'Native local transport, emergency crypto and location for MAPS'
  s.description    = s.summary
  s.license        = { :type => 'MIT' }
  s.author         = { 'MAPS' => 'MAPS' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
