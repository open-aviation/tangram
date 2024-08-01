from flask_wtf import FlaskForm
from wtforms import SubmitField, validators
from wtforms.fields import DateField, FloatField, IntegerField, TimeField


class DatabaseForm(FlaskForm):
    startdate = DateField("Start Date", validators=(validators.DataRequired(),))
    starttime = TimeField("", validators=(validators.DataRequired(),))
    enddate = DateField("End Date", validators=(validators.DataRequired(),))
    endtime = TimeField("", validators=(validators.DataRequired(),))
    submit = SubmitField("Submit")


class ThresholdForm(FlaskForm):
    multiplier = FloatField("Multiplier", validators=(validators.DataRequired(),))
    threshold = IntegerField("Min Threshold", validators=(validators.DataRequired(),))
    submit = SubmitField("Submit")
