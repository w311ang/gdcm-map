package xyz.z543998.gdcmmap.compass

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 自定义 Capacitor 插件：通过系统 TYPE_ROTATION_VECTOR 传感器读取指南针朝向。
 *
 * 与网页 DeviceOrientationEvent 不同，ROTATION_VECTOR 是 Android 系统/芯片厂商在驱动层
 * 融合了陀螺仪、加速度计、磁力计数据后的结果（与原生地图/导航 App 使用的数据源完全一致），
 * 已内置滤波与倾斜补偿，无需在应用层再做任何平滑处理即可获得稳定、准确的方向读数。
 */
@CapacitorPlugin(name = "Compass")
class CompassPlugin : Plugin(), SensorEventListener {

    private lateinit var sensorManager: SensorManager
    private var rotationSensor: Sensor? = null

    private val rotationMatrix = FloatArray(9)
    private val orientationAngles = FloatArray(3)

    override fun load() {
        sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val sensor = rotationSensor
        if (sensor == null) {
            call.reject("设备不支持 ROTATION_VECTOR 传感器")
            return
        }
        sensorManager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        sensorManager.unregisterListener(this)
        call.resolve()
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ROTATION_VECTOR) return

        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
        SensorManager.getOrientation(rotationMatrix, orientationAngles)

        // orientationAngles[0] 为绕 Z 轴的方位角（弧度），范围 -PI..PI，正北为 0，顺时针为负
        val azimuthDegrees = Math.toDegrees(orientationAngles[0].toDouble())
        val heading = (azimuthDegrees + 360) % 360

        val data = JSObject()
        data.put("heading", heading)
        notifyListeners("heading", data)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // 无需处理精度变化事件
    }

    override fun handleOnDestroy() {
        sensorManager.unregisterListener(this)
    }
}
