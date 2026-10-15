from django.urls import path

from . import management_views as mgmt
from . import views

app_name = "wechat"

urlpatterns = [
    path("login/", views.wechat_login, name="wechat-login"),
    path("check/", views.wechat_check, name="wechat-check"),
    # 注册：走新的"提交申请"逻辑（申请与账号分离）
    path("register/", views.wechat_register_v2, name="wechat-register"),
    path("register/status/", views.wechat_register_status, name="wechat-register-status"),
    # 用户管理 - 账号审批（IsAdminUser）
    path("sales-applications/", mgmt.sales_application_list, name="sales-application-list"),
    path("sales-applications/stats/", mgmt.sales_application_stats, name="sales-application-stats"),
    path("sales-applications/<uuid:pk>/", mgmt.sales_application_detail, name="sales-application-detail"),
    path("sales-applications/<uuid:pk>/approve/", mgmt.sales_application_approve, name="sales-application-approve"),
    path("sales-applications/<uuid:pk>/reject/", mgmt.sales_application_reject, name="sales-application-reject"),
]
