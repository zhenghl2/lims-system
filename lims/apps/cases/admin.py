from django.contrib import admin
from .models import Case, CaseSample

@admin.register(Case)
class CaseAdmin(admin.ModelAdmin):
    list_display = ["case_number", "panel", "status", "is_urgent", "created_at"]
    list_filter = ["status", "panel", "is_urgent"]
    search_fields = ["case_number", "clinic_name", "sales_person"]

@admin.register(CaseSample)
class CaseSampleAdmin(admin.ModelAdmin):
    list_display = ["case", "sample", "role", "sample_source", "received_at"]
    list_filter = ["role", "sample_source"]
