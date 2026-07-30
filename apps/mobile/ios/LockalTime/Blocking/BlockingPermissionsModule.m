// Phase 3 task 3.6: classic Objective-C bridge exposing the Swift
// BlockingPermissionsModule class to React Native — Swift classes still
// need this companion file under RN's bridge module system (works under
// both old and new architecture via the interop layer). Compiles cleanly
// as of Phase 7's cloud macOS CI (see BlockingPermissionsModule.swift's
// header).
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(BlockingPermissionsModule, NSObject)

RCT_EXTERN_METHOD(getStatus
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(request
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
