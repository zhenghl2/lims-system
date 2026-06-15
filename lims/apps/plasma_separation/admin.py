from django.contrib import admin
from .models import PlasmaSeparationBatch, PlasmaSeparationSample, PlasmaSeparationPhoto

admin.site.register(PlasmaSeparationBatch)
admin.site.register(PlasmaSeparationSample)
admin.site.register(PlasmaSeparationPhoto)
