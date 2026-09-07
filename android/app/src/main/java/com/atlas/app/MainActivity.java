package com.atlas.app;

import android.app.PictureInPictureParams;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Draw the WebView behind Android system bars, like dedicated
        // navigation apps do. CSS safe-area insets keep interactive controls
        // clear while the map itself can use the whole physical display.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getBridge() == null) {
            return;
        }

        getBridge().getWebView().evaluateJavascript(
            "document.documentElement.dataset.atlasNavigationActive === 'true'",
            value -> {
                if (!"true".equals(value) || isInPictureInPictureMode()) {
                    return;
                }

                PictureInPictureParams params =
                    new PictureInPictureParams.Builder()
                        .setAspectRatio(new Rational(9, 16))
                        .build();

                try {
                    enterPictureInPictureMode(params);
                } catch (IllegalStateException ignored) {
                    // Android can reject a PiP transition during fast activity
                    // state changes. Navigation remains active in that case.
                }
            }
        );
    }
}
