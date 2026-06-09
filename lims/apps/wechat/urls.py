from django.urls import path

from . import views

app_name = "wechat"

urlpatterns = [
    path("login/", views.wechat_login, name="wechat-login"),
]
