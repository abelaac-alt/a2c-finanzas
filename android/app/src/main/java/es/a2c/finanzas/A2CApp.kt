package es.a2c.finanzas

import android.app.Activity
import android.app.Application
import android.os.Bundle
import es.a2c.finanzas.work.RefreshWorker

class A2CApp : Application() {
    companion object {
        /** true mientras alguna pantalla de A2C está visible. */
        @Volatile var inForeground = false
            private set
    }

    private var started = 0

    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        RefreshWorker.schedulePeriodic(this)
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityStarted(activity: Activity) { started++; inForeground = true }
            override fun onActivityStopped(activity: Activity) {
                started = (started - 1).coerceAtLeast(0)
                inForeground = started > 0
                if (!inForeground) RefreshWorker.runOnce(this@A2CApp)
            }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityResumed(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }
}
