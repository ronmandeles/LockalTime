// Phase 9: classic Objective-C bridge exposing the Swift
// IosFamilyControlsModule to React Native — same shape as
// AppBlockerModule.m. Every method is store-and-apply; the decision rule
// behind them lives in JS (see the Swift file's header for why).
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(IosFamilyControlsModule, NSObject)

RCT_EXTERN_METHOD(getKnownIds
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(applyKnownSelection
                  : (NSArray *)ids resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(applyCachedSelection
                  : (NSString *)cacheKey resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(presentPicker
                  : (NSDictionary *)options resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end
