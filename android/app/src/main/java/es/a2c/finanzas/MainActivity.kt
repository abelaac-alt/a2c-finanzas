package es.a2c.finanzas

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

class MainActivity : ComponentActivity() {
    companion object {
        const val EXTRA_DESTINATION = "destination"
        const val EXTRA_PAYMENT_ID = "payment_id"
    }

    lateinit var webView: WebView
        private set
    private val main = Handler(Looper.getMainLooper())
    private var webReady = false
    private var pendingIntentAction: Intent? = null

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .setDomain(Config.ASSET_HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    // ---------- Selector de archivos (<input type="file">) ----------
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val fileLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    // ---------- Guardar archivos (copias de seguridad) ----------
    private var pendingSave: ByteArray? = null
    private val saveLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val bytes = pendingSave; pendingSave = null
        val uri = result.data?.data
        if (result.resultCode != RESULT_OK || uri == null || bytes == null) return@registerForActivityResult
        runCatching { contentResolver.openOutputStream(uri)?.use { it.write(bytes) } }
            .onSuccess { toast(getString(R.string.file_saved)) }
            .onFailure { toast(getString(R.string.file_save_error)) }
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        evaluate("window.dispatchEvent(new CustomEvent('a2c:native-permission',{detail:{granted:$granted}}))")
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.WHITE, Color.WHITE),
            navigationBarStyle = SystemBarStyle.light(Color.WHITE, Color.WHITE)
        )
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val root = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            setBackgroundColor(Color.WHITE)
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        root.addView(webView)
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            setSupportZoom(false)
            builtInZoomControls = false
            textZoom = (resources.configuration.fontScale * 100).toInt().coerceIn(85, 130)
            userAgentString = "$userAgentString A2CAndroid/${BuildConfig.VERSION_NAME}"
        }
        webView.addJavascriptInterface(NativeBridge(this), "A2CNative")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == Config.ASSET_HOST) return false
                openExternal(url)
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                webReady = false
                waitForApp(0)
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    fileLauncher.launch(params.createIntent().apply { addCategory(Intent.CATEGORY_OPENABLE) })
                    true
                } catch (error: ActivityNotFoundException) {
                    fileCallback = null
                    toast(getString(R.string.file_picker_error))
                    false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(function(){try{var m=document.querySelector('#modal-root');if(m&&m.childElementCount){A2C.closeModal();return 'handled';}" +
                        "if(window.A2C&&A2C.state&&A2C.state.user&&A2C.state.page!=='home'){A2C.navigate('home');return 'handled';}}catch(e){}return 'exit';})()"
                ) { result -> if (result?.contains("exit") != false) moveTaskToBack(true) }
            }
        })

        if (savedInstanceState != null && webView.restoreState(savedInstanceState) != null) {
            // Estado restaurado tras un cambio de configuración
        } else {
            val destination = intent.getStringExtra(EXTRA_DESTINATION)
            webView.loadUrl(if (destination != null) "${Config.START_URL}?destination=${Uri.encode(destination)}" else Config.START_URL)
        }
        if (intent.hasExtra(EXTRA_PAYMENT_ID)) pendingIntentAction = intent
        askNotificationPermissionOnce()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingIntentAction = intent
        if (webReady) handleIntentAction()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    /** Espera a que la web termine de arrancar (app.js marca __A2C_BOOT_STATUS='ready'). */
    private fun waitForApp(attempt: Int) {
        webView.evaluateJavascript("window.__A2C_BOOT_STATUS||''") { status ->
            if (status?.contains("ready") == true) {
                webReady = true
                handleIntentAction()
            } else if (attempt < 60) {
                main.postDelayed({ waitForApp(attempt + 1) }, 500)
            }
        }
    }

    private fun handleIntentAction() {
        val action = pendingIntentAction ?: return
        pendingIntentAction = null
        action.getStringExtra(EXTRA_PAYMENT_ID)?.let { id ->
            action.removeExtra(EXTRA_PAYMENT_ID)
            registerPendingPayment(id)
            return
        }
        action.getStringExtra(EXTRA_DESTINATION)?.let { destination ->
            action.removeExtra(EXTRA_DESTINATION)
            evaluate("window.a2cAndroidOpenDestination&&window.a2cAndroidOpenDestination(${JSONObject.quote(destination)})")
        }
    }

    /** Registra en A2C un pago detectado, usando la función web a2cAndroidRegisterPayment. */
    fun registerPendingPayment(id: String) {
        val payment = es.a2c.finanzas.payments.PaymentStore.find(this, id)
        if (payment == null) { toast(getString(R.string.payment_not_found)); return }
        val payload = JSONObject()
            .put("amount_cents", payment.getLong("amount_cents"))
            .put("merchant", payment.optString("merchant"))
            .put("concept", payment.optString("merchant"))
            .put("payment_time", payment.optLong("time"))
            .put("fingerprint", payment.optString("fingerprint"))
            .put("payment_method", "bank")
        evaluate(
            "(function(){if(!window.a2cAndroidRegisterPayment){A2CNative.onPaymentResult(${JSONObject.quote(id)},JSON.stringify({ok:false,error:'La app no está lista.'}));return;}" +
                "window.a2cAndroidRegisterPayment($payload).then(function(r){A2CNative.onPaymentResult(${JSONObject.quote(id)},JSON.stringify(r||{}));" +
                "try{A2C.ui.render({preserveScroll:true});}catch(e){}});})()"
        )
    }

    fun evaluate(script: String) = main.post { webView.evaluateJavascript(script, null) }

    fun saveFile(name: String, mime: String, bytes: ByteArray) = main.post {
        pendingSave = bytes
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mime.ifBlank { "application/octet-stream" }
            putExtra(Intent.EXTRA_TITLE, name)
        }
        try { saveLauncher.launch(intent) } catch (error: ActivityNotFoundException) { pendingSave = null; toast(getString(R.string.file_save_error)) }
    }

    fun requestNotificationPermission() = main.post {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun askNotificationPermissionOnce() {
        if (Store.bool(this, "asked_notifications", false)) return
        Store.putBool(this, "asked_notifications", true)
        requestNotificationPermission()
    }

    fun openExternal(uri: Uri) {
        try { startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        catch (error: ActivityNotFoundException) { toast(getString(R.string.link_error)) }
    }

    fun toast(message: String) = main.post { Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
}
