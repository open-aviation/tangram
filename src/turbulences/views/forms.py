from flask_wtf import FlaskForm
from wtforms.fields import DateField
from wtforms.fields import TimeField
from wtforms.validators import DataRequired
from wtforms import validators, SubmitField


class InfoForm(FlaskForm):
    startdate = DateField("Start Date", validators=(validators.DataRequired(),))
    starttime = TimeField("", validators=(validators.DataRequired(),))
    enddate = DateField("End Date", validators=(validators.DataRequired(),))
    endtime = TimeField("", validators=(validators.DataRequired(),))
    submit = SubmitField("Submit")
