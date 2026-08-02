package com.commandcenter.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.text.InputType;
import android.view.GestureDetector;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.Nullable;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.StringReader;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
  private static final String TAILSCALE_HOST = "commandcenter";
  private static final int TAILSCALE_PORT = 5050;
  private static final int DIRECT_PORT = 5050;
  private static final String DEFAULT_IP = "[REDACTED_LAN_IP]";
  public static final String PREFS = "cc_mobile";
  private static final String HUBS_KEY = "saved_hubs";
  private static final String LAST_HUB_KEY = "last_hub";

  private WebView webView;
  private ProgressBar progressBar;
  private TextView statusText;
  private TextView errorTitle;
  private TextView errorText;
  private ScrollView errorScroll;
  private PowerManager.WakeLock wakeLock;
  private SharedPreferences prefs;
  private GestureDetector gestureDetector;
  private int swipeSlop = 100;
  private float lastTouchY;
  private boolean refreshing = false;

  @Override
  protected void onCreate(@Nullable Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    setContentView(buildUi());
    prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
    acquireWakeLock();
    statusText.setText("Command Center · v1.1.0");
    setupWebView();
    boolean loaded = resolveAndLoadBase(true);
    if (!loaded) showError("No hub found", "Check WiFi, Tailscale, or PC power, then pull down to refresh.");
    gestureDetector = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
      @Override public boolean onFling(MotionEvent e1, MotionEvent e2, float vx, float vy) {
        if (e1 == null || e2 == null) return false;
        if (e1.getY() - e2.getY() > swipeSlop && Math.abs(vy) > Math.abs(vx)) {
          hideError();
          reloadHub();
          return true;
        }
        return false;
      }
      @Override public boolean onSingleTapUp(MotionEvent e) {
        return false;
      }
    });
    webView.setOnTouchListener((v, event) -> {
      gestureDetector.onTouchEvent(event);
      if (event.getAction() == MotionEvent.ACTION_DOWN) {
        lastTouchY = event.getY();
      }
      return false;
    });
  }

  private View buildUi() {
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(Color.parseColor("#0B0014"));

    LinearLayout topRow = new LinearLayout(this);
    topRow.setOrientation(LinearLayout.HORIZONTAL);
    topRow.setBackgroundColor(Color.parseColor("#0B0014"));
    topRow.setPadding(20, 24, 20, 6);
    LinearLayout statusCol = new LinearLayout(this);
    statusCol.setOrientation(LinearLayout.VERTICAL);
    LinearLayout.LayoutParams statusColLp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
    statusText = new TextView(this);
    statusText.setTextColor(Color.parseColor("#B9F6CA"));
    statusText.setTextSize(11f);
    statusCol.addView(statusText, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    TextView sub = new TextView(this);
    sub.setText("swipe down to refresh · tap ⚙ hub");
    sub.setTextColor(Color.parseColor("#8899AA"));
    sub.setTextSize(9f);
    statusCol.addView(sub, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    topRow.addView(statusCol, statusColLp);
    TextView settingsBtn = new TextView(this);
    settingsBtn.setText("⚙");
    settingsBtn.setTextSize(18f);
    settingsBtn.setPadding(16, 0, 0, 0);
    settingsBtn.setOnClickListener(v -> showHubPicker());
    topRow.addView(settingsBtn, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    root.addView(topRow, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

    progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
    progressBar.getIndeterminateDrawable().setTint(Color.parseColor("#00E5FF"));
    progressBar.setMax(100);
    root.addView(progressBar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

    FrameLayout webWrap = new FrameLayout(this);
    webWrap.setBackgroundColor(Color.parseColor("#06000A"));
    webView = new WebView(this);
    webWrap.addView(webView, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    LinearLayout.LayoutParams wvLp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f);
    root.addView(webWrap, wvLp);

    errorScroll = new ScrollView(this);
    errorScroll.setVisibility(View.GONE);
    errorScroll.setBackgroundColor(Color.parseColor("#0B0014"));
    errorScroll.setPadding(24, 24, 24, 24);
    LinearLayout errorBox = new LinearLayout(this);
    errorBox.setOrientation(LinearLayout.VERTICAL);
    errorTitle = new TextView(this);
    errorTitle.setText("Hub unreachable");
    errorTitle.setTextColor(Color.parseColor("#FF6B9D"));
    errorTitle.setTextSize(16f);
    errorTitle.setPadding(0, 0, 0, 16);
    errorBox.addView(errorTitle, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
    errorText = new TextView(this);
    errorText.setTextColor(Color.parseColor("#DDDDDD"));
    errorText.setTextSize(12f);
    errorText.setLineSpacing(1.2f, 1.2f);
    errorBox.addView(errorText, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
    errorScroll.addView(errorBox);
    root.addView(errorScroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

    return root;
  }

  private void setupWebView() {
    WebSettings s = webView.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setCacheMode(WebSettings.LOAD_DEFAULT);
    s.setAllowFileAccess(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
    s.setSupportZoom(true);
    s.setBuiltInZoomControls(true);
    s.setDisplayZoomControls(false);

    webView.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        String host = u.getHost();
        String scheme = u.getScheme();
        if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
          boolean isLocal = "127.0.0.1".equals(host)
              || "localhost".equals(host)
              || "192.168.".equals(host != null && host.length() >= 7 ? host.substring(0, 7) : "")
              || host != null && (host.endsWith(".local") || host.endsWith(".tailscale.net") || host.endsWith(".ts.net"));
          if (isLocal) {
            return false;
          }
        }
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(u.toString()));
        startActivity(i);
        return true;
      }

      @Override public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
        showError("Connection failed", description + "\n\nURL: " + failingUrl + "\n\nTry opening Settings (⚙) and switching hub.");
      }

      @Override public void onPageFinished(WebView view, String url) {
        progressBar.setVisibility(View.GONE);
        progressBar.setProgress(100);
        hideError();
        injectMobileCSS();
      }
    });

    webView.setWebChromeClient(new WebChromeClient() {
      @Override public void onProgressChanged(WebView view, int progress) {
        progressBar.setProgress(progress);
        progressBar.setVisibility(progress >= 100 ? View.GONE : View.VISIBLE);
      }
    });
  }

  private void injectMobileCSS() {
    String css = "javascript:(function(){" +
      "var style=document.createElement('style');" +
      "style.innerHTML='@media (max-width:480px){body{padding:8px!important}.container{max-width:100%!important;padding:0!important}img{max-width:100%;height:auto!important}.card{flex-direction:column!important}}';" +
      "document.head.appendChild(style);" +
      "})()";
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
      webView.evaluateJavascript(css, null);
    }
  }

  private void loadHub(String base) {
    progressBar.setVisibility(View.VISIBLE);
    progressBar.setProgress(0);
    webView.loadUrl(base + "/");
  }

  private void reloadHub() {
    boolean loaded = resolveAndLoadBase(true);
    if (!loaded) showError("Hub unreachable", "Make sure PC is on and hub is running.");
    refreshing = false;
  }

  private boolean resolveAndLoadBase(boolean autoLabel) {
    String saved = prefs.getString(LAST_HUB_KEY, null);
    if (saved != null && testReachable(saved)) {
      if (autoLabel) statusText.setText(saved + (isLocalTailscale(saved) ? " · tailscale" : " · saved"));
      loadHub(saved);
      hideError();
      return true;
    }
    List<String> savedHubs = getSavedHubs();
    for (int i = 0; i < savedHubs.size(); i++) {
      String h = savedHubs.get(i);
      if (testReachable(h)) {
        prefs.edit().putString(LAST_HUB_KEY, h).apply();
        if (autoLabel) statusText.setText(h + (isLocalTailscale(h) ? " · tailscale" : ""));
        loadHub(h);
        hideError();
        return true;
      }
    }

    String[] candidates = new String[] {
      "http://" + TAILSCALE_HOST + ".ts.net:" + TAILSCALE_PORT,
      "http://" + TAILSCALE_HOST + ".local:" + TAILSCALE_PORT,
      "http://" + DEFAULT_IP + ":" + DIRECT_PORT
    };
    for (int i = 0; i < candidates.length; i++) {
      if (testReachable(candidates[i])) {
        prefs.edit().putString(LAST_HUB_KEY, candidates[i]).apply();
        if (autoLabel) statusText.setText(candidates[i] + (i == 0 ? " · tailscale" : i == 1 ? " · local" : ""));
        loadHub(candidates[i]);
        hideError();
        return true;
      }
    }
    return false;
  }

  private boolean isLocalTailscale(String url) {
    String h = null;
    try { h = new java.net.URL(url).getHost(); } catch (Exception ignored) {}
    return h != null && (h.endsWith(".tailscale.net") || h.endsWith(".ts.net") || "localhost".equals(h) || h.startsWith("commandcenter"));
  }

  private String getCurrentBaseUrl() {
    return prefs.getString(LAST_HUB_KEY, null);
  }

  private boolean testReachable(String url) {
    try {
      java.net.URL u = new java.net.URL(url);
      java.net.SocketAddress addr = new java.net.InetSocketAddress(u.getHost(), u.getPort());
      java.net.Socket s = new java.net.Socket();
      s.connect(addr, 900);
      s.close();
      return true;
    } catch (Exception ignored) {}
    return false;
  }

  private void showError(String title, String message) {
    runOnUiThread(() -> {
      errorTitle.setText(title);
      errorText.setText(message);
      errorScroll.setVisibility(View.VISIBLE);
    });
  }

  private void hideError() {
    runOnUiThread(() -> errorScroll.setVisibility(View.GONE));
  }

  private void showHubPicker() {
    AlertDialog.Builder builder = new AlertDialog.Builder(this);
    builder.setTitle("Command Center Hub");
    List<String> hubs = getSavedHubs();
    if (hubs.isEmpty()) {
      hubs.add("http://" + TAILSCALE_HOST + ".ts.net:" + TAILSCALE_PORT);
      hubs.add("http://" + TAILSCALE_HOST + ".local:" + TAILSCALE_PORT);
      hubs.add("http://" + DEFAULT_IP + ":" + DIRECT_PORT);
    }
    String[] items = new String[hubs.size()];
    final int[] checked = new int[1];
    String current = getCurrentBaseUrl();
    if (current == null) current = "";
    for (int i = 0; i < hubs.size(); i++) {
      items[i] = hubs.get(i);
      if (hubs.get(i).equals(current)) checked[0] = i;
    }
    builder.setSingleChoiceItems(items, checked[0], (dialog, which) -> {
      String choice = items[which];
      prefs.edit().putString(LAST_HUB_KEY, choice).apply();
      if (testReachable(choice)) {
        statusText.setText(choice);
        loadHub(choice);
        hideError();
      } else {
        showError("Hub offline", choice + " did not respond.\nMake sure the PC is on and hub is running.");
      }
      dialog.dismiss();
    });
    builder.setNeutralButton("+ Add", (dialog, which) -> {
      AlertDialog.Builder input = new AlertDialog.Builder(this);
      input.setTitle("Add hub URL");
      final EditText et = new EditText(this);
      et.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
      et.setHint("http://[REDACTED_LAN_IP]:5050");
      input.setView(et);
      input.setPositiveButton("Save", (d, w) -> {
        String val = et.getText().toString().trim();
        if (!val.isEmpty() && !val.endsWith("/")) val += "/";
        if (!val.isEmpty()) {
          List<String> updated = getSavedHubs();
          if (!updated.contains(val)) updated.add(val);
          saveHubs(updated);
          Toast.makeText(this, "Hub saved", Toast.LENGTH_SHORT).show();
        }
      });
      input.setNegativeButton("Cancel", null);
      input.show();
    });
    builder.setNegativeButton("Close", null);
    builder.show();
  }

  private List<String> getSavedHubs() {
    List<String> result = new ArrayList<>();
    String raw = prefs.getString(HUBS_KEY, null);
    if (raw == null) return result;
    String[] parts = raw.split(",");
    for (String p : parts) {
      if (!p.trim().isEmpty()) result.add(p.trim());
    }
    return result;
  }

  private void saveHubs(List<String> hubs) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < hubs.size(); i++) {
      if (i > 0) sb.append(",");
      sb.append(hubs.get(i));
    }
    prefs.edit().putString(HUBS_KEY, sb.toString()).apply();
  }

  private void acquireWakeLock() {
    try {
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      if (pm != null) {
        wakeLock = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "cc:mobile");
        wakeLock.acquire(10 * 60 * 1000L);
      }
    } catch (Exception ignored) {}
  }

  @Override public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
      webView.goBack();
      return true;
    }
    return super.onKeyDown(keyCode, event);
  }

  @Override public void onConfigurationChanged(Configuration newConfig) {
    super.onConfigurationChanged(newConfig);
  }

  @Override protected void onDestroy() {
    if (wakeLock != null && wakeLock.isHeld()) {
      wakeLock.release();
    }
    super.onDestroy();
  }
}
