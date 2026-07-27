//
// Phase 3 task 3.6 (backlog.md): required for the Swift native modules in
// Blocking/ to see RN's Objective-C bridge types (RCTPromiseResolveBlock,
// RCTPromiseRejectBlock, RCTEventEmitter). Not yet wired into the Xcode
// project — Build Settings > Swift Compiler - General >
// "Objective-C Bridging Header" must point to this file
// ($(SRCROOT)/LockalTime/LockalTime-Bridging-Header.h) manually in Xcode,
// since that setting lives in project.pbxproj (see docs/MANUAL_QA.md's iOS
// extension target setup section for the full manual step list — this is
// one more entry on that list, not a separate target).
//
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
