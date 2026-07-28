#!/usr/bin/env ruby
# Phase 7 (Release Prep): scripted equivalent of docs/MANUAL_QA.md's
# "One-time Xcode project setup" checklist for Phase 3 task 3.6 (the iOS
# native blocker bridge) -- run once, programmatically, by the macOS CI job
# (.github/workflows/ci.yml's ios-build job) via the xcodeproj gem, instead
# of by hand in the Xcode GUI. This is the first thing that ever adds
# apps/mobile/ios/LockalTime/Blocking/*.swift and the
# LockalTimeBlockerExtension target to project.pbxproj -- everything below
# was previously source-only, referenced by nothing.
#
# Idempotent: safe to re-run (checks for existing file refs/targets before
# adding), since CI may run this against a project.pbxproj this script
# already touched in a prior run on the same branch.
#
# Usage: ruby scripts/wire-blocking-target.rb   (run from apps/mobile/ios/)

require 'xcodeproj'

PROJECT_PATH = 'LockalTime.xcodeproj'
DEPLOYMENT_TARGET = '15.1' # matches the existing IPHONEOS_DEPLOYMENT_TARGET
APP_GROUP = 'group.com.lockaltime.app'
MAIN_BUNDLE_ID = 'com.lockaltime.app'
EXTENSION_BUNDLE_ID = "#{MAIN_BUNDLE_ID}.LockalTimeBlockerExtension"

project = Xcodeproj::Project.open(PROJECT_PATH)
main_target = project.targets.find { |t| t.name == 'LockalTime' }
raise "LockalTime target not found" if main_target.nil?

lockaltime_group = project.main_group['LockalTime']
raise "LockalTime group not found" if lockaltime_group.nil?

# ---------------------------------------------------------------------
# 1. Blocking/ Swift + Obj-C files -> LockalTime target
# ---------------------------------------------------------------------
blocking_group = lockaltime_group['Blocking'] || lockaltime_group.new_group('Blocking', 'Blocking')

blocking_files = Dir.glob('LockalTime/Blocking/*.{swift,m}').sort
shared_app_group_ref = nil

blocking_files.each do |path|
  basename = File.basename(path)
  existing = blocking_group.files.find { |f| f.path == basename }
  file_ref = existing || blocking_group.new_reference(basename)
  shared_app_group_ref = file_ref if basename == 'SharedAppGroup.swift'

  already_in_target = main_target.source_build_phase.files_references.include?(file_ref)
  main_target.add_file_references([file_ref]) unless already_in_target
end

# ---------------------------------------------------------------------
# 2. Bridging header + entitlements build settings on LockalTime
# ---------------------------------------------------------------------
main_target.build_configurations.each do |config|
  config.build_settings['SWIFT_OBJC_BRIDGING_HEADER'] = 'LockalTime/LockalTime-Bridging-Header.h'
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'LockalTime/LockalTime.entitlements'
  # App Groups + Family Controls need the real "Signing & Capabilities" UI
  # entry too on a signed build (this only points at the entitlements
  # file); CODE_SIGN_STYLE/team assignment stays whatever CI's build
  # invocation passes (see ci.yml -- this repo has no distribution
  # cert/profile yet, so CI builds unsigned/for the simulator).
end

# ---------------------------------------------------------------------
# 3. en.lproj / he.lproj Localizable.strings as one variant group
# ---------------------------------------------------------------------
existing_variant_group = lockaltime_group.children.find do |c|
  c.is_a?(Xcodeproj::Project::Object::PBXVariantGroup) && c.name == 'Localizable.strings'
end

if existing_variant_group.nil?
  variant_group = project.new(Xcodeproj::Project::Object::PBXVariantGroup)
  variant_group.name = 'Localizable.strings'
  variant_group.source_tree = '<group>'
  lockaltime_group.children << variant_group

  %w[en he].each do |locale|
    file_ref = variant_group.new_reference("#{locale}.lproj/Localizable.strings")
    file_ref.name = locale
  end

  main_target.add_resources([variant_group])
end

# ---------------------------------------------------------------------
# 4. LockalTimeBlockerExtension target (DeviceActivityMonitor extension)
# ---------------------------------------------------------------------
ext_target = project.targets.find { |t| t.name == 'LockalTimeBlockerExtension' }

if ext_target.nil?
  ext_target = project.new_target(:app_extension, 'LockalTimeBlockerExtension', :ios, DEPLOYMENT_TARGET)

  ext_group = project.main_group.new_group('LockalTimeBlockerExtension', 'LockalTimeBlockerExtension')
  ext_swift_ref = ext_group.new_reference('DeviceActivityMonitorExtension.swift')
  ext_target.add_file_references([ext_swift_ref])

  # SharedAppGroup.swift lives in the main app's Blocking/ group but must
  # compile into BOTH targets -- one file reference, two targets, never
  # duplicated (docs/MANUAL_QA.md's original instruction).
  raise "SharedAppGroup.swift file reference not found" if shared_app_group_ref.nil?
  ext_target.add_file_references([shared_app_group_ref])

  ext_target.build_configurations.each do |config|
    # Phase 7 debugging note: project.new_target(:app_extension, ...) does
    # NOT default PRODUCT_NAME the way Xcode's own "New Target" wizard
    # does -- left unset, it resolves to an empty string, so the built
    # product is literally named ".appex" (no name before the extension),
    # and Xcode's build system treats the per-arch merge step and the
    # product's own output as two commands colliding on that one identical
    # (empty) path -- "Multiple commands produce '.../.appex'". Caught by
    # the real ios-build CI run (.github/workflows/ci.yml), not locally
    # (no Mac to catch it with beforehand).
    config.build_settings['PRODUCT_NAME'] = '$(TARGET_NAME)'
    config.build_settings['INFOPLIST_FILE'] = 'LockalTimeBlockerExtension/Info.plist'
    config.build_settings['CODE_SIGN_ENTITLEMENTS'] = 'LockalTimeBlockerExtension/LockalTimeBlockerExtension.entitlements'
    config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = EXTENSION_BUNDLE_ID
    config.build_settings['SWIFT_VERSION'] = '5.0'
    config.build_settings['SKIP_INSTALL'] = 'YES'
    config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET
  end

  # Embed the built .appex into the host app's PlugIns directory, and make
  # the host app depend on (build before) the extension.
  main_target.add_dependency(ext_target)
  embed_phase = main_target.new_copy_files_build_phase('Embed Foundation Extensions')
  embed_phase.symbol_dst_subfolder_spec = :plug_ins
  embed_build_file = embed_phase.add_file_reference(ext_target.product_reference)
  embed_build_file.settings = { 'ATTRIBUTES' => ['RemoveHeaderOnCopy'] }
end

project.save

puts 'wire-blocking-target.rb: done.'
